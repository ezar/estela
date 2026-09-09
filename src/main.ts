/**
 * estela
 *
 * A field of particles that reacts to your hands through the webcam. The camera
 * is processed every frame and never drawn: the hand is inferred from the hole
 * it opens in the swarm.
 */
import './style.css';
import { startCamera, type CameraStream } from './camera/stream';
import { Recorder, isRecordingSupported } from './capture/recorder';
import { createContext } from './gl/utils';
import { restPositionsFromText } from './modes/shape';
import { ParticleBuffers } from './sim/buffers';
import { Simulation, type Mode } from './sim/simulation';
import { Renderer } from './render/renderer';
import { HandTracker } from './tracking/landmarker';
import { RepulsorField } from './tracking/repulsors';
import { Hud } from './ui/hud';

/** One half second hitch integrated at its real dt disintegrates the field. */
const MAX_DELTA = 0.033;
const DEFAULT_TEXT = 'estela';

function defaultParticleCount(): number {
  const cores = navigator.hardwareConcurrency || 4;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  return coarse || cores <= 4 ? 50_000 : 100_000;
}

class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly simulation: Simulation;
  private readonly renderer: Renderer;
  private readonly repulsors = new RepulsorField();
  private readonly tracker = new HandTracker();
  private readonly recorder = new Recorder();
  private readonly hud: Hud;

  private buffers: ParticleBuffers;
  private particleCount = defaultParticleCount();
  private bounds: [number, number] = [1, 1];
  private pixelRatio = 1;
  private mode: Mode = 'flow';
  private text = DEFAULT_TEXT;
  private camera: CameraStream | null = null;
  private videoAspect = 4 / 3;
  private running = false;
  private lastFrame = 0;
  private frameHandle = 0;
  private shapeTimer: number | null = null;
  private wakeLock: WakeLockSentinel | null = null;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.canvas = canvas;
    this.gl = createContext(canvas);
    this.simulation = new Simulation(this.gl);
    this.renderer = new Renderer(this.gl);

    this.resize();
    this.buffers = this.createBuffers();

    this.hud = new Hud(ui, {
      mode: this.mode,
      text: this.text,
      canRecord: isRecordingSupported(),
      sliders: [
        {
          key: 'particles',
          label: 'particles',
          min: 10_000,
          max: 200_000,
          step: 10_000,
          value: this.particleCount,
          format: (value) => `${Math.round(value / 1000)}k`,
        },
        {
          key: 'trail',
          label: 'trail',
          min: 0.02,
          max: 0.3,
          step: 0.005,
          value: this.renderer.settings.trailAlpha,
          format: (value) => value.toFixed(3),
        },
        {
          key: 'radius',
          label: 'radius',
          min: 0.06,
          max: 0.4,
          step: 0.01,
          value: this.simulation.settings.radius,
        },
        {
          key: 'strength',
          label: 'strength',
          min: 1,
          max: 25,
          step: 0.1,
          value: this.simulation.settings.strength,
          format: (value) => value.toFixed(1),
        },
      ],
      onStart: () => void this.enter(),
      onModeChange: (mode) => this.setMode(mode),
      onTextChange: (text) => this.setText(text),
      onRecord: () => this.record(),
      onSlider: (key, value) => this.setSetting(key, value),
    });

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => this.onVisibilityChange());

    this.start();
  }

  // -- Lifecycle ------------------------------------------------------------

  /** The field runs from the first frame; the start screen simply covers it. */
  private start() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now() / 1000;
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  private stop() {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
  }

  /** Camera permission, model load and one warm up inference. */
  private async enter() {
    this.hud.setStartBusy(true);
    try {
      const [camera] = await Promise.all([startCamera(), this.tracker.load()]);
      this.camera = camera;
      this.videoAspect = camera.video.videoWidth / Math.max(1, camera.video.videoHeight) || 4 / 3;
      this.tracker.warmUp(camera.video);
      this.tracker.start(camera.video, ({ hands, time }) => {
        this.repulsors.update(hands, time, {
          bounds: this.bounds,
          videoAspect: this.videoAspect,
        });
      });
      this.hud.setStatus(null);
    } catch (error) {
      // Without a camera the field still flows, it just cannot be pushed.
      const message =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Camera blocked · the field flows on its own'
          : 'No camera · the field flows on its own';
      this.hud.setStatus(message);
      setTimeout(() => this.hud.setStatus(null), 6000);
    } finally {
      this.hud.setStartBusy(false);
      this.hud.hideStart();
      void this.requestWakeLock();
    }
  }

  private frame = () => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.frame);

    const now = performance.now() / 1000;
    const dt = Math.min(now - this.lastFrame, MAX_DELTA);
    this.lastFrame = now;
    if (dt <= 0) return;

    const { data, count } = this.repulsors.sample(now, dt);
    this.simulation.step(this.buffers, dt, this.bounds, this.mode, data, count);
    this.renderer.draw(this.buffers, this.bounds, this.pixelRatio);
  };

  private onVisibilityChange() {
    if (document.hidden) {
      // Otherwise the accumulated dt detonates the field on return.
      this.stop();
      return;
    }
    this.start();
    void this.requestWakeLock();
  }

  private async requestWakeLock() {
    if (document.hidden || !navigator.wakeLock) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
      });
    } catch {
      // Not critical: the screen may just dim.
    }
  }

  // -- Field ----------------------------------------------------------------

  private createBuffers(): ParticleBuffers {
    return new ParticleBuffers(
      this.gl,
      this.particleCount,
      this.bounds,
      this.simulation.attributes,
      this.renderer.attributes,
    );
  }

  private resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    this.canvas.width = width;
    this.canvas.height = height;
    this.pixelRatio = ratio;
    this.bounds = [width / height, 1];
    this.renderer.resize(width, height);
    if (this.mode === 'shape') this.updateShape();
  }

  private setMode(mode: Mode) {
    this.mode = mode;
    if (mode === 'shape') this.updateShape();
  }

  private setText(text: string) {
    this.text = text;
    if (this.shapeTimer !== null) clearTimeout(this.shapeTimer);
    // Rasterising on every keystroke would stutter on a long word.
    this.shapeTimer = window.setTimeout(() => this.updateShape(), 160);
  }

  private updateShape() {
    this.buffers.setRestPositions(
      restPositionsFromText(this.text, { bounds: this.bounds, count: this.particleCount }),
    );
  }

  private setSetting(key: string, value: number) {
    switch (key) {
      case 'particles': {
        const count = Math.round(value);
        if (count === this.particleCount) return;
        this.particleCount = count;
        this.buffers.dispose();
        this.buffers = this.createBuffers();
        if (this.mode === 'shape') this.updateShape();
        return;
      }
      case 'trail':
        this.renderer.settings.trailAlpha = value;
        return;
      case 'radius':
        this.simulation.settings.radius = value;
        return;
      case 'strength':
        this.simulation.settings.strength = value;
        return;
      default:
        return;
    }
  }

  // -- Capture --------------------------------------------------------------

  private record() {
    if (this.recorder.isRecording) return;
    this.recorder.start(this.canvas, {
      onStart: () => this.hud.setRecording(true),
      onTick: (left) => this.hud.setCountdown(left),
      onFinish: (outcome) => {
        this.hud.setRecording(false);
        this.hud.setStatus(outcome === 'shared' ? 'Shared' : 'Saved');
        setTimeout(() => this.hud.setStatus(null), 2500);
      },
      onError: (error) => {
        this.hud.setRecording(false);
        this.hud.setStatus(error.message);
        setTimeout(() => this.hud.setStatus(null), 4000);
      },
    });
  }

  dispose() {
    this.stop();
    this.tracker.dispose();
    this.camera?.stop();
    this.buffers.dispose();
    this.simulation.dispose();
    this.renderer.dispose();
  }
}

function boot() {
  const canvas = document.querySelector<HTMLCanvasElement>('#field');
  const ui = document.querySelector<HTMLElement>('#ui');
  if (!canvas || !ui) throw new Error('Missing #field or #ui in the document.');

  try {
    const app = new App(canvas, ui);
    window.addEventListener('pagehide', () => app.dispose());
  } catch (error) {
    // WebGL2 has shipped on effectively every device since iOS 15. There is no
    // fallback path: say so and stop.
    const message =
      error instanceof Error ? error.message : 'Something went wrong starting the field.';
    ui.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'fatal';
    const title = document.createElement('h1');
    title.textContent = 'estela';
    const text = document.createElement('p');
    text.textContent = message;
    panel.append(title, text);
    ui.append(panel);
  }
}

boot();
