import { useEffect, useRef, useState } from 'react';
import { fromHex, hex } from '../protocol/lighting';
import { compose, frameToFill, MUSIC_MODES, MusicVisualizer, RT_MODES, RtEffect, type ColorSource, type MusicMode, type RtMode } from '../protocol/live';
import { keyIndexForCode } from '../device/codeMap';
import { SCREEN_MODES, ScreenSync, type ScreenMode } from '../protocol/screenSync';
import { batteryColours, clockColours, coloursToFrame, timerColours } from '../protocol/signals';
import { renderEffect } from '../protocol/effectDesigner';
import { EffectDesigner } from './EffectDesigner';
import { effectStore } from './effectStore';
import { Keyboard } from './Keyboard';
import { loadPerKey, perKeyMap } from './perKeyStore';
import { startTicker } from './ticker';
import type { DeviceApi } from './useDevice';

const FRAME_MS = 30; // ~33 fps (vendor streams ~50 fps)
/** Screen sync samples a tiny downscaled frame: cheap, and plenty for 82 keys. */
const SCREEN_W = 32;
const SCREEN_H = 12;

type Source = 'solid' | 'rainbow' | 'perkey';

export function LiveTab({ api }: { api: DeviceApi }) {
  const { dev, snap } = api;
  const [kind, setKind] = useState<'effects' | 'music' | 'screen' | 'signals' | 'custom'>('effects');
  const [customId, setCustomId] = useState(() => effectStore.get()[0].id);
  const pressedAt = useRef(new Map<number, number>());
  const [signal, setSignal] = useState<'timer' | 'clock' | 'battery'>('timer');
  const [timerMin, setTimerMin] = useState(25);
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null);
  const [timerLeft, setTimerLeft] = useState<string | null>(null);
  const [screenMode, setScreenMode] = useState<ScreenMode>('zones');
  const [screenSmooth, setScreenSmooth] = useState(0.5);
  const [saturation, setSaturation] = useState(1.3);
  const [screenLabel, setScreenLabel] = useState<string | null>(null);
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
  const screen = useRef<{ stream: MediaStream; video: HTMLVideoElement; ctx: CanvasRenderingContext2D } | null>(null);
  const sync = useRef(new ScreenSync());
  Object.assign(sync.current, { mode: screenMode, smooth: screenSmooth, saturation });
  const music = useRef(new MusicVisualizer(musicMode, gain, smooth, autoGain));
  const cfg = useRef({ kind, source, color, brightness, signal, timerMin, battery, customId });
  cfg.current = { kind, source, color, brightness, signal, timerMin, battery, customId };
  effect.current.mode = rtMode;
  effect.current.speed = speed;
  Object.assign(music.current, { mode: musicMode, gain, smooth, autoGain });

  // Follow mode reacts to key presses while this page has focus.
  useEffect(() => {
    if (!running) return;
    const kd = (e: KeyboardEvent) => {
      const led = keyIndexForCode(e.code);
      if (led !== undefined) {
        effect.current.press(led);
        pressedAt.current.set(led, performance.now() / 1000);
      }
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [running]);

  // Frame loop.
  const { setError } = api;
  useEffect(() => {
    if (!running || !dev) return;
    let busy = false;
    let frames = 0;
    let lastPreview = 0;
    let lastFps = performance.now();
    const t0 = performance.now();
    const perkey = perKeyMap(loadPerKey());
    const bins = new Uint8Array(128);
    let timerDone = false;
    let lastTimerLabel = '';
    const ticker = startTicker(FRAME_MS, async () => {
      if (busy) return; // never queue frames behind a slow USB write
      busy = true;
      try {
        const t = (performance.now() - t0) / 1000;
        const c = cfg.current;
        const src: ColorSource =
          c.source === 'solid' ? { kind: 'solid', color: fromHex(c.color) } : c.source === 'perkey' ? { kind: 'perkey', colors: perkey, fallback: fromHex(c.color) } : { kind: 'rainbow' };
        let frame: Uint8Array;
        const bg = c.source === 'solid' ? fromHex(c.color) : ([60, 120, 90] as [number, number, number]);
        if (c.kind === 'custom') {
          const fx = effectStore.get().find((e) => e.id === c.customId) ?? effectStore.get()[0];
          frame = coloursToFrame(renderEffect(fx, performance.now() / 1000, pressedAt.current), c.brightness);
        } else if (c.kind === 'signals') {
          if (c.signal === 'timer') {
            const total = c.timerMin * 60_000;
            const el = performance.now() - t0;
            frame = coloursToFrame(timerColours(el, total, bg), c.brightness);
            if (el >= total && !timerDone) {
              timerDone = true;
              notifyDone(c.timerMin);
            }
            const left = Math.max(0, Math.ceil((total - el) / 1000));
            const label = el >= total ? "Time's up" : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`;
            if (label !== lastTimerLabel) {
              lastTimerLabel = label;
              setTimerLeft(label);
            }
          } else if (c.signal === 'clock') frame = coloursToFrame(clockColours(new Date(), bg), c.brightness);
          else frame = coloursToFrame(batteryColours(c.battery?.level ?? 0, !!c.battery?.charging, t, bg), c.brightness);
        } else if (c.kind === 'screen') {
          const sc = screen.current;
          if (sc && sc.video.readyState >= 2) {
            sc.ctx.drawImage(sc.video, 0, 0, SCREEN_W, SCREEN_H);
            frame = sync.current.frame(sc.ctx.getImageData(0, 0, SCREEN_W, SCREEN_H), c.brightness);
          } else frame = new Uint8Array(378);
        } else {
          let intensity: Map<number, number>;
          if (c.kind === 'music') {
            if (audio.current) audio.current.analyser.getByteFrequencyData(bins);
            else bins.fill(0);
            intensity = music.current.intensities(bins, t);
          } else intensity = effect.current.intensities(t);
          frame = compose(intensity, src, t, c.brightness);
        }
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
        setError(`Live stream stopped: ${e instanceof Error ? e.message : String(e)}`);
        setRunning(false);
      } finally {
        busy = false;
      }
    });
    return () => ticker.stop();
  }, [running, dev, setError]); // not `api`: it's a new object every render and would restart the clock

  // Laptop battery (Chrome: navigator.getBattery) for the battery signal.
  useEffect(() => {
    if (kind !== 'signals' || signal !== 'battery') return;
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void }> };
    if (!nav.getBattery) return;
    let b: Awaited<ReturnType<NonNullable<typeof nav.getBattery>>> | null = null;
    const upd = () => b && setBattery({ level: b.level, charging: b.charging });
    nav.getBattery().then((x) => {
      b = x;
      upd();
      x.addEventListener('levelchange', upd);
      x.addEventListener('chargingchange', upd);
    });
    return () => {
      b?.removeEventListener('levelchange', upd);
      b?.removeEventListener('chargingchange', upd);
    };
  }, [kind, signal]);

  function notifyDone(min: number) {
    try {
      if ('Notification' in window && Notification.permission === 'granted') new Notification('MK75 timer', { body: `${min} minutes are up.`, icon: 'icon-192.png' });
    } catch {
      /* notifications unavailable */
    }
  }

  // Leaving the tab stops streaming; restore the saved effect if we were live.
  const runningRef = useRef(running);
  runningRef.current = running;
  const latest = useRef({ dev, snap }); // the unmount cleanup must restore the current profile, not the first render's
  latest.current = { dev, snap };
  useEffect(
    () => () => {
      stopAudio();
      stopScreen();
      const { dev, snap } = latest.current;
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

  function stopScreen() {
    screen.current?.stream.getTracks().forEach((t) => t.stop());
    screen.current = null;
    setScreenLabel(null);
  }

  async function startScreen() {
    stopScreen();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      const canvas = document.createElement('canvas');
      canvas.width = SCREEN_W;
      canvas.height = SCREEN_H;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas is not available');
      screen.current = { stream, video, ctx };
      const track = stream.getVideoTracks()[0];
      setScreenLabel(track.label && track.label.length <= 40 ? track.label : 'Shared screen');
      track.addEventListener('ended', stopScreen);
    } catch (e) {
      if ((e as Error)?.name !== 'NotAllowedError') api.setError(e instanceof Error ? e.message : String(e));
    }
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
          <span className="muted small">
            {running ? `streaming · ${fps} fps` : 'stopped'}
            {running && kind === 'signals' && signal === 'timer' && timerLeft ? ` · ${timerLeft}` : ''}
          </span>
        </header>
        <Keyboard selected={new Set()} onSelect={() => {}} fill={(k) => (running ? preview.get(k.index) : undefined)} />
        <div className="actions">
          {running ? (
            <button className="primary rec" onClick={stop}>
              ■ Stop
            </button>
          ) : (
            <button
              className="primary"
              onClick={() => {
                if (kind === 'signals' && signal === 'timer' && 'Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
                setTimerLeft(null);
                setRunning(true);
              }}
              disabled={!!api.busy || (kind === 'music' && !audioLabel) || (kind === 'screen' && !screenLabel)}>
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
            <button role="tab" aria-selected={kind === 'screen'} className={kind === 'screen' ? 'on' : ''} onClick={() => setKind('screen')}>
              Screen sync
            </button>
            <button role="tab" aria-selected={kind === 'signals'} className={kind === 'signals' ? 'on' : ''} onClick={() => setKind('signals')}>
              Signals
            </button>
            <button role="tab" aria-selected={kind === 'custom'} className={kind === 'custom' ? 'on' : ''} onClick={() => setKind('custom')}>
              Custom
            </button>
          </div>
          {kind === 'custom' ? (
            <EffectDesigner selectedId={customId} onSelect={setCustomId} />
          ) : kind === 'signals' ? (
            <>
              <div className="modes">
                {(
                  [
                    ['timer', 'Timer (F-row progress)'],
                    ['clock', 'Clock'],
                    ['battery', 'Laptop battery'],
                  ] as const
                ).map(([id, name]) => (
                  <button key={id} className={`mode${signal === id ? ' on' : ''}`} onClick={() => setSignal(id)} aria-pressed={signal === id}>
                    {name}
                  </button>
                ))}
              </div>
              {signal === 'timer' && (
                <label className="chk">
                  Minutes <input type="number" min={1} max={180} value={timerMin} onChange={(e) => setTimerMin(Math.max(1, Number(e.target.value)))} style={{ width: 70 }} />
                  <span className="hint">The F-row fills up; the board flashes and a notification appears when time's up. Start restarts the timer.</span>
                </label>
              )}
              {signal === 'clock' && <p className="hint">Hours light the number row (1–12), each F-key is 5 minutes, Esc pulses every second.</p>}
              {signal === 'battery' && (
                <p className="hint">
                  {battery ? `Battery ${Math.round(battery.level * 100)}%${battery.charging ? ' · charging' : ''}. ` : 'Battery level is not available in this browser. '}
                  The number row shows this computer's battery (not the keyboard's).
                </p>
              )}
            </>
          ) : kind === 'screen' ? (
            <>
              <div className="row">
                <button onClick={startScreen}>Share screen / window / tab…</button>
                {screenLabel && <span className="pill ok">{screenLabel}</span>}
              </div>
              <p className="hint">The keyboard follows the colours of what you share, like ambient TV lighting. Nothing leaves this computer.</p>
              <div className="modes">
                {SCREEN_MODES.map((m) => (
                  <button key={m.id} className={`mode${screenMode === m.id ? ' on' : ''}`} onClick={() => setScreenMode(m.id)} aria-pressed={screenMode === m.id}>
                    {m.name}
                  </button>
                ))}
              </div>
              <Slider label="Smooth" min={0} max={0.9} step={0.05} value={screenSmooth} onChange={setScreenSmooth} fmt={(v) => `${Math.round(v * 100)}%`} />
              <Slider label="Saturation" min={0.5} max={2.5} step={0.05} value={saturation} onChange={setSaturation} fmt={(v) => `${v.toFixed(2)}×`} />
            </>
          ) : kind === 'effects' ? (
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
          {kind === 'screen' || kind === 'custom' ? (
            <p className="muted small">{kind === 'screen' ? 'Colours come from the shared screen.' : 'Colours are set per layer in the designer.'}</p>
          ) : (
            <>
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
            </>
          )}
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
