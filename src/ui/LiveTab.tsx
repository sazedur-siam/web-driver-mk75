import { useEffect, useRef, useState } from 'react';
import { MK75_KEYS } from '../device/mk75Layout';
import { HID_KEYS, HID_MODIFIERS } from '../protocol/keycodes';
import { fromHex, hex, type RGB } from '../protocol/lighting';
import { compose, frameToFill, MUSIC_MODES, MusicVisualizer, RT_MODES, RtEffect, type ColorSource, type MusicMode, type RtMode } from '../protocol/live';
import { vkToHid } from '../protocol/mock';
import { Keyboard } from './Keyboard';
import type { DeviceApi } from './useDevice';

const FRAME_MS = 30; // ~33 fps (vendor streams ~50 fps)

// KeyboardEvent.code → LED index, for the Follow (reactive) effect.
const USAGE_BY_CODE = new Map<string, number>([...HID_KEYS.map((k) => [k.code, k.usage] as const), ...HID_MODIFIERS.map((m) => [m.code, m.usage] as const)]);
const LED_BY_USAGE = new Map<number, number>();
for (const k of MK75_KEYS) {
  const u = vkToHid(k.vk);
  if (u !== undefined) LED_BY_USAGE.set(u, k.index);
}

function loadPerKey(): Map<number, RGB> {
  try {
    const o = JSON.parse(localStorage.getItem('mk75.perkey.v1') || '{}') as Record<string, RGB>;
    return new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
  } catch {
    return new Map();
  }
}

type Source = 'solid' | 'rainbow' | 'perkey';

export function LiveTab({ api }: { api: DeviceApi }) {
  const { dev, snap } = api;
  const [kind, setKind] = useState<'effects' | 'music'>('effects');
  const [rtMode, setRtMode] = useState<RtMode>('Rainbow wave');
  const [musicMode, setMusicMode] = useState<MusicMode>('Spectrum bars');
  const [source, setSource] = useState<Source>('rainbow');
  const [color, setColor] = useState('#3fdc5f');
  const [speed, setSpeed] = useState(1);
  const [brightness, setBrightness] = useState(1);
  const [gain, setGain] = useState(1.5);
  const [smooth, setSmooth] = useState(0.55);
  const [autoGain, setAutoGain] = useState(true);
  const [running, setRunning] = useState(false);
  const [audioLabel, setAudioLabel] = useState<string | null>(null);
  const [preview, setPreview] = useState<Map<number, string>>(new Map());
  const [fps, setFps] = useState(0);

  const audio = useRef<{ ctx: AudioContext; analyser: AnalyserNode; stream: MediaStream } | null>(null);
  const effect = useRef(new RtEffect(rtMode, speed));
  const music = useRef(new MusicVisualizer(musicMode, gain, smooth, autoGain));
  const cfg = useRef({ kind, source, color, brightness });
  cfg.current = { kind, source, color, brightness };
  effect.current.mode = rtMode;
  effect.current.speed = speed;
  Object.assign(music.current, { mode: musicMode, gain, smooth, autoGain });

  // Follow mode reacts to key presses while this page has focus.
  useEffect(() => {
    if (!running) return;
    const kd = (e: KeyboardEvent) => {
      const u = USAGE_BY_CODE.get(e.code);
      const led = u !== undefined ? LED_BY_USAGE.get(u) : undefined;
      if (led !== undefined) effect.current.press(led);
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [running]);

  // Frame loop.
  useEffect(() => {
    if (!running || !dev) return;
    let busy = false;
    let frames = 0;
    let lastPreview = 0;
    let lastFps = performance.now();
    const t0 = performance.now();
    const perkey = loadPerKey();
    const bins = new Uint8Array(128);
    const id = window.setInterval(async () => {
      if (busy) return; // never queue frames behind a slow USB write
      busy = true;
      try {
        const t = (performance.now() - t0) / 1000;
        const c = cfg.current;
        const src: ColorSource =
          c.source === 'solid' ? { kind: 'solid', color: fromHex(c.color) } : c.source === 'perkey' ? { kind: 'perkey', colors: perkey, fallback: fromHex(c.color) } : { kind: 'rainbow' };
        let intensity: Map<number, number>;
        if (c.kind === 'music') {
          if (audio.current) audio.current.analyser.getByteFrequencyData(bins);
          else bins.fill(0);
          intensity = music.current.intensities(bins, t);
        } else intensity = effect.current.intensities(t);
        const frame = compose(intensity, src, t, c.brightness);
        await dev.sendLiveFrame(frame);
        frames++;
        const now = performance.now();
        if (now - lastPreview > 60) {
          setPreview(frameToFill(frame));
          lastPreview = now;
        }
        if (now - lastFps > 1000) {
          setFps(Math.round((frames * 1000) / (now - lastFps)));
          frames = 0;
          lastFps = now;
        }
      } catch (e) {
        api.setError(`Live stream stopped: ${e instanceof Error ? e.message : String(e)}`);
        setRunning(false);
      } finally {
        busy = false;
      }
    }, FRAME_MS);
    return () => window.clearInterval(id);
  }, [running, dev, api]);

  // Leaving the tab stops streaming; restore the saved effect if we were live.
  const runningRef = useRef(running);
  runningRef.current = running;
  useEffect(
    () => () => {
      stopAudio();
      if (runningRef.current && dev && snap) void dev.writeProfile(snap.profile).catch(() => undefined);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function stopAudio() {
    audio.current?.stream.getTracks().forEach((t) => t.stop());
    void audio.current?.ctx.close();
    audio.current = null;
    setAudioLabel(null);
  }

  async function startAudio(from: 'system' | 'mic') {
    stopAudio();
    try {
      const stream =
        from === 'mic'
          ? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
          : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      stream.getVideoTracks().forEach((t) => t.stop());
      if (stream.getAudioTracks().length === 0) throw new Error('No audio was shared. In the share dialog, tick "Share system audio" / "Share tab audio".');
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      ctx.createMediaStreamSource(stream).connect(analyser);
      audio.current = { ctx, analyser, stream };
      setAudioLabel(stream.getAudioTracks()[0].label || (from === 'mic' ? 'Microphone' : 'Shared audio'));
      stream.getAudioTracks()[0].addEventListener('ended', stopAudio);
    } catch (e) {
      api.setError(e instanceof Error ? e.message : String(e));
    }
  }

  const stop = () =>
    api.run('Restoring saved lighting', async () => {
      setRunning(false);
      // The vendor sends no "stop" command; re-writing the stored profile brings the saved effect back at once.
      if (dev && snap) await dev.writeProfile(snap.profile);
    });

  if (!dev || !snap) return null;
  if (!dev.canStream) {
    return (
      <section className="card">
        <h2>Live effects</h2>
        <p className="muted">This connection doesn't expose the MK75 live-lighting channel (HID report 0x08). Connect the keyboard by USB cable.</p>
      </section>
    );
  }

  return (
    <div className="stack">
      <section className="card">
        <header className="card-h">
          <h2>Live preview</h2>
          <span className="muted small">{running ? `streaming · ${fps} fps` : 'stopped'}</span>
        </header>
        <Keyboard selected={new Set()} onSelect={() => {}} fill={(k) => (running ? preview.get(k.index) : undefined)} />
        <div className="actions">
          {running ? (
            <button className="primary rec" onClick={stop}>
              ■ Stop
            </button>
          ) : (
            <button className="primary" onClick={() => setRunning(true)} disabled={!!api.busy || (kind === 'music' && !audioLabel)}>
              ▶ Start
            </button>
          )}
          <span className="hint">
            Like the official app, live lighting runs from this computer: keep this tab open. Stopping restores your saved effect.
          </span>
        </div>
      </section>

      <div className="panel-grid">
        <section className="card">
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={kind === 'effects'} className={kind === 'effects' ? 'on' : ''} onClick={() => setKind('effects')}>
              Real-time effects
            </button>
            <button role="tab" aria-selected={kind === 'music'} className={kind === 'music' ? 'on' : ''} onClick={() => setKind('music')}>
              Music
            </button>
          </div>
          {kind === 'effects' ? (
            <>
              <div className="modes">
                {RT_MODES.map((m) => (
                  <button key={m} className={`mode${rtMode === m ? ' on' : ''}`} onClick={() => setRtMode(m)} aria-pressed={rtMode === m}>
                    {m}
                  </button>
                ))}
              </div>
              {rtMode === 'Follow' && <p className="hint">Follow lights the keys you press while this page is focused.</p>}
              <Slider label="Speed" min={0.25} max={3} step={0.05} value={speed} onChange={setSpeed} fmt={(v) => `${v.toFixed(2)}×`} />
            </>
          ) : (
            <>
              <div className="row">
                <button onClick={() => startAudio('system')}>Share system / tab audio…</button>
                <button onClick={() => startAudio('mic')}>Use microphone</button>
                {audioLabel && <span className="pill ok">{audioLabel}</span>}
              </div>
              <p className="hint">
                Browsers can't read system audio directly. Use "Share system audio" (Windows/ChromeOS) or share a tab with audio, or use a microphone.
              </p>
              <div className="modes">
                {MUSIC_MODES.map((m) => (
                  <button key={m} className={`mode${musicMode === m ? ' on' : ''}`} onClick={() => setMusicMode(m)} aria-pressed={musicMode === m}>
                    {m}
                  </button>
                ))}
              </div>
              <label className="chk">
                <input type="checkbox" checked={autoGain} onChange={(e) => setAutoGain(e.target.checked)} /> Auto gain
              </label>
              {!autoGain && <Slider label="Gain" min={0.2} max={6} step={0.1} value={gain} onChange={setGain} fmt={(v) => `${v.toFixed(1)}×`} />}
              <Slider label="Smooth" min={0} max={0.9} step={0.05} value={smooth} onChange={setSmooth} fmt={(v) => `${Math.round(v * 100)}%`} />
            </>
          )}
        </section>

        <section className="card">
          <h2>Colour</h2>
          <div className="seg">
            {(['rainbow', 'solid', 'perkey'] as Source[]).map((s) => (
              <button key={s} className={source === s ? 'on' : ''} onClick={() => setSource(s)}>
                {s === 'rainbow' ? 'Rainbow' : s === 'solid' ? 'Single colour' : 'Per-key colours'}
              </button>
            ))}
          </div>
          {source !== 'rainbow' && (
            <div className="row">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Effect colour" className="color-big" />
              <span className="muted small">{source === 'perkey' ? 'Used for keys without a per-key colour' : hex(fromHex(color))}</span>
            </div>
          )}
          {source === 'perkey' && <p className="hint">Uses the layout from the Per-key RGB tab.</p>}
          <Slider label="Brightness" min={0.1} max={1} step={0.05} value={brightness} onChange={setBrightness} fmt={(v) => `${Math.round(v * 100)}%`} />
        </section>
      </div>
    </div>
  );
}

function Slider(p: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  return (
    <label className="field">
      <span className="field-l">
        {p.label} <b>{p.fmt(p.value)}</b>
      </span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  );
}
