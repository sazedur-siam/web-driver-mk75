import { useEffect, useMemo, useRef, useState } from 'react';
import { BOARD_H, BOARD_W, coloursToRecord, placeImage, recordToFrame, sampleBoard, type Placement } from '../protocol/imageMap';
import { buildLedMatrix, CUSTOM_MODE_INDEX, hex, parseProfile, patchProfile, type RGB } from '../protocol/lighting';
import { Keyboard } from './Keyboard';
import { perKeyMap, savePerKey } from './perKeyStore';
import { startTicker } from './ticker';
import type { DeviceApi } from './useDevice';

const MAX_FRAMES = 300;
const SCALE = 0.5; // sampling canvas = half the board's layout units: plenty for 82 keys
const CW = Math.round(BOARD_W * SCALE);
const CH = Math.round(BOARD_H * SCALE);

interface Loaded {
  name: string;
  frames: ImageBitmap[];
  delays: number[]; // ms per frame
}

type DecodedImage = { image: { displayWidth: number; displayHeight: number; duration: number | null; close(): void } & CanvasImageSource };
type ImageDecoderLike = {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(o: { frameIndex: number }): Promise<DecodedImage>;
  close(): void;
};

async function loadFile(file: File): Promise<Loaded> {
  const Decoder = (window as unknown as { ImageDecoder?: new (o: { data: ArrayBuffer; type: string }) => ImageDecoderLike }).ImageDecoder;
  if (file.type === 'image/gif' && Decoder) {
    const dec = new Decoder({ data: await file.arrayBuffer(), type: file.type });
    await dec.tracks.ready;
    const count = Math.min(MAX_FRAMES, dec.tracks.selectedTrack?.frameCount ?? 1);
    const frames: ImageBitmap[] = [];
    const delays: number[] = [];
    for (let i = 0; i < count; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      frames.push(await createImageBitmap(image));
      delays.push(Math.max(20, (image.duration ?? 100_000) / 1000));
      image.close();
    }
    dec.close();
    return { name: file.name, frames, delays };
  }
  return { name: file.name, frames: [await createImageBitmap(file)], delays: [100] };
}

/** Map an image or animated GIF onto the keys: save it as per-key colours, or play a GIF live. */
export function ImageToKeys({ api, onSaved }: { api: DeviceApi; onSaved?: (colors: Record<number, RGB>) => void }) {
  const { dev, snap } = api;
  const [img, setImg] = useState<Loaded | null>(null);
  const [place, setPlace] = useState<Placement>({ zoom: 1, x: 0, y: 0 });
  const [bright, setBright] = useState(1);
  const [contrast, setContrast] = useState(1.2);
  const [frameNo, setFrameNo] = useState(0);
  const [playing, setPlaying] = useState<'off' | 'preview' | 'keyboard'>('off');
  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = CW;
    c.height = CH;
    return c;
  }, []);
  const ctx = useMemo(() => canvas.getContext('2d', { willReadFrequently: true })!, [canvas]);
  const fileRef = useRef<HTMLInputElement>(null);

  const sample = (bmp: ImageBitmap) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CW, CH);
    const r = placeImage(bmp.width, bmp.height, CW, CH, place);
    ctx.drawImage(bmp, r.dx, r.dy, r.dw, r.dh);
    return coloursToRecord(sampleBoard(ctx.getImageData(0, 0, CW, CH)), bright, contrast);
  };

  const current = img ? sample(img.frames[frameNo % img.frames.length]) : null;

  // Animation (on-screen preview, optionally streamed to the keyboard).
  useEffect(() => {
    if (playing === 'off' || !img || img.frames.length < 2) return;
    const frames = img.frames.map(sample); // pre-sample with the current settings
    let i = frameNo % img.frames.length;
    let next = performance.now();
    let busy = false;
    const ticker = startTicker(15, async () => {
      if (busy || performance.now() < next) return;
      busy = true;
      try {
        i = (i + 1) % frames.length;
        next = performance.now() + img.delays[i];
        setFrameNo(i);
        if (playing === 'keyboard' && dev) await dev.sendLiveFrame(recordToFrame(frames[i]));
      } catch (e) {
        api.setError(`Playback stopped: ${e instanceof Error ? e.message : String(e)}`);
        setPlaying('off');
      } finally {
        busy = false;
      }
    });
    return () => ticker.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, img, place, bright, contrast]);

  // Restore the saved effect if we leave while streaming.
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useEffect(
    () => () => {
      if (playingRef.current === 'keyboard' && dev && snap) void dev.writeProfile(snap.profile).catch(() => undefined);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const stopKeyboard = () =>
    api.run('Restoring saved lighting', async () => {
      setPlaying('off');
      if (dev && snap) await dev.writeProfile(snap.profile);
    });

  const save = () =>
    current &&
    dev &&
    snap &&
    api.run('Saving image as per-key colours', async () => {
      savePerKey(current);
      onSaved?.(current);
      await dev.writeLedMatrix(buildLedMatrix(perKeyMap(current)));
      const st = parseProfile(snap.profile);
      st.activeIndex = CUSTOM_MODE_INDEX;
      await dev.writeProfile(patchProfile(snap.profile, st));
      api.setSnap({ ...snap, profile: await dev.readProfile() });
      api.push({ dir: 'info', text: `Image "${img?.name}" saved as per-key colours` });
    });

  const animated = (img?.frames.length ?? 0) > 1;

  return (
    <section className="card">
      <header className="card-h">
        <h2>Image / GIF to keys</h2>
        <span className="muted small">{img ? `${img.name}${animated ? ` · ${img.frames.length} frames` : ''}` : 'PNG, JPG, WebP or animated GIF'}</span>
      </header>
      <div className="row">
        <button onClick={() => fileRef.current?.click()}>Choose image…</button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              setPlaying('off');
              setFrameNo(0);
              setImg(await loadFile(f));
            } catch (err) {
              api.setError(`Couldn't open image: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
              e.target.value = '';
            }
          }}
        />
        {img && <span className="hint">82 keys is a very low resolution: bold, simple images work best.</span>}
      </div>
      {img && current && (
        <>
          <Keyboard selected={new Set()} onSelect={() => {}} fill={(k) => (current[k.index] ? hex(current[k.index]) : undefined)} />
          <div className="slider-grid">
            <Range label="Zoom" min={1} max={4} step={0.05} value={place.zoom} onChange={(v) => setPlace({ ...place, zoom: v })} fmt={(v) => `${v.toFixed(2)}×`} />
            <Range label="Pan ←→" min={-1} max={1} step={0.02} value={place.x} onChange={(v) => setPlace({ ...place, x: v })} fmt={(v) => v.toFixed(2)} />
            <Range label="Pan ↑↓" min={-1} max={1} step={0.02} value={place.y} onChange={(v) => setPlace({ ...place, y: v })} fmt={(v) => v.toFixed(2)} />
            <Range label="Brightness" min={0.2} max={1.5} step={0.05} value={bright} onChange={setBright} fmt={(v) => `${Math.round(v * 100)}%`} />
            <Range label="Contrast" min={0.5} max={2.5} step={0.05} value={contrast} onChange={setContrast} fmt={(v) => `${v.toFixed(2)}×`} />
          </div>
          <div className="actions">
            <button className="primary" onClick={save} disabled={!dev || !!api.busy || playing === 'keyboard'}>
              Save {animated ? 'this frame' : 'image'} as per-key colours
            </button>
            {animated && playing !== 'keyboard' && (
              <button onClick={() => setPlaying(playing === 'preview' ? 'off' : 'preview')}>{playing === 'preview' ? 'Pause preview' : 'Preview animation'}</button>
            )}
            {animated && dev?.canStream && (playing === 'keyboard' ? (
              <button className="primary rec" onClick={stopKeyboard}>
                ■ Stop on keyboard
              </button>
            ) : (
              <button onClick={() => setPlaying('keyboard')} disabled={!!api.busy}>
                ▶ Play on keyboard
              </button>
            ))}
          </div>
          {animated && <p className="hint">Animations play live from this computer (keep the tab open); stopping restores your saved effect.</p>}
        </>
      )}
    </section>
  );
}

function Range(p: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  return (
    <label className="field">
      <span className="field-l">
        {p.label} <b>{p.fmt(p.value)}</b>
      </span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  );
}
