/**
 * Everything that is not the field.
 *
 * Nothing permanent sits on top of the particles: the controls appear on tap
 * and fade after three seconds, and they hide themselves entirely while a
 * recording is running so they never end up in the frame.
 */
import { RECORDING_SECONDS } from '../capture/recorder';
import type { Mode } from '../sim/simulation';

const FADE_DELAY = 3000;

export interface SliderSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (value: number) => string;
}

export interface HudOptions {
  mode: Mode;
  text: string;
  sliders: SliderSpec[];
  canRecord: boolean;
  onStart: () => void;
  onModeChange: (mode: Mode) => void;
  onTextChange: (text: string) => void;
  onRecord: () => void;
  onSlider: (key: string, value: number) => void;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly options: HudOptions;
  private readonly start: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly controls: HTMLElement;
  private readonly shapeRow: HTMLElement;
  private readonly modeButton: HTMLButtonElement;
  private readonly recordButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly countdown: HTMLElement;
  private readonly countdownLabel: HTMLElement;
  private fadeTimer: number | null = null;
  private pinned = false;

  constructor(root: HTMLElement, options: HudOptions) {
    this.root = root;
    this.options = options;

    this.status = element('div', 'status');
    this.status.classList.add('is-hidden');

    this.countdownLabel = element('span');
    this.countdown = element('div', 'countdown');
    this.countdown.append(element('span', 'dot'), this.countdownLabel);

    this.recordButton = button('Record 10s', () => options.onRecord());
    this.recordButton.disabled = !options.canRecord;
    if (!options.canRecord) this.recordButton.title = 'This browser cannot record the canvas.';

    this.modeButton = button(modeLabel(options.mode), () => {
      const next: Mode = this.modeButton.dataset.mode === 'flow' ? 'shape' : 'flow';
      this.setMode(next);
      options.onModeChange(next);
    });
    this.modeButton.dataset.mode = options.mode;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = options.text;
    input.placeholder = 'write something';
    input.maxLength = 24;
    input.addEventListener('input', () => options.onTextChange(input.value));

    this.shapeRow = element('div', 'row shape-row');
    this.shapeRow.append(input);

    const mainRow = element('div', 'row');
    mainRow.append(this.recordButton, this.modeButton);

    this.controls = element('div', 'controls');
    this.controls.append(mainRow, this.shapeRow, this.buildSettings());
    this.controls.addEventListener('pointerenter', () => this.pin(true));
    this.controls.addEventListener('pointerleave', () => this.pin(false));
    this.controls.addEventListener('focusin', () => this.pin(true));
    this.controls.addEventListener('focusout', () => this.pin(false));

    this.startButton = button('Enter', () => options.onStart());
    this.start = this.buildStart();

    root.append(this.status, this.countdown, this.controls, this.start);
    this.setMode(options.mode);
    this.reveal();

    for (const event of ['pointerdown', 'pointermove', 'keydown'] as const) {
      window.addEventListener(event, () => this.reveal(), { passive: true });
    }
  }

  private buildStart(): HTMLElement {
    const start = element('div', 'start');
    const title = element('h1');
    title.textContent = 'enjambre';
    const line = element('p');
    line.textContent = 'A hundred thousand particles that move out of the way of your hands.';
    const note = element('p', 'note');
    note.textContent =
      'The camera is used to find your hands and is never drawn, never recorded and never leaves this device.';
    start.append(title, line, this.startButton, note);
    return start;
  }

  private buildSettings(): HTMLElement {
    const details = document.createElement('details');
    details.className = 'settings';
    const summary = document.createElement('summary');
    summary.textContent = 'Settings';
    const body = element('div', 'body');

    for (const spec of this.options.sliders) {
      const row = element('label', 'slider');
      const name = element('span');
      name.textContent = spec.label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(spec.step);
      input.value = String(spec.value);
      const output = document.createElement('output');
      const render = (value: number) => {
        output.textContent = spec.format ? spec.format(value) : value.toFixed(2);
      };
      render(spec.value);
      input.addEventListener('input', () => {
        const value = Number(input.value);
        render(value);
        this.options.onSlider(spec.key, value);
      });
      row.append(name, input, output);
      body.append(row);
    }

    details.append(summary, body);
    return details;
  }

  setMode(mode: Mode) {
    this.modeButton.dataset.mode = mode;
    this.modeButton.textContent = modeLabel(mode);
    this.shapeRow.classList.toggle('is-visible', mode === 'shape');
  }

  setStatus(text: string | null) {
    this.status.textContent = text ?? '';
    this.status.classList.toggle('is-hidden', text === null);
  }

  hideStart() {
    this.start.classList.add('is-hidden');
    setTimeout(() => this.start.remove(), 700);
    this.reveal();
  }

  setStartBusy(busy: boolean, label = 'Enter') {
    this.startButton.disabled = busy;
    this.startButton.textContent = busy ? 'Waking the swarm…' : label;
  }

  setRecording(recording: boolean) {
    this.controls.classList.toggle('is-recording', recording);
    this.countdown.classList.toggle('is-visible', recording);
    this.recordButton.disabled = recording || !this.options.canRecord;
    if (!recording) this.reveal();
  }

  setCountdown(secondsLeft: number) {
    const left = Math.max(0, Math.min(RECORDING_SECONDS, secondsLeft));
    this.countdownLabel.textContent = `${left}s`;
  }

  fatal(message: string) {
    const panel = element('div', 'fatal');
    const title = element('h1');
    title.textContent = 'enjambre';
    const text = element('p');
    text.textContent = message;
    panel.append(title, text);
    this.root.append(panel);
  }

  private pin(pinned: boolean) {
    this.pinned = pinned;
    this.reveal();
  }

  /** Shows the controls and restarts the three second countdown to fading. */
  private reveal() {
    this.controls.classList.remove('is-faded');
    if (this.fadeTimer !== null) clearTimeout(this.fadeTimer);
    if (this.pinned) return;
    this.fadeTimer = window.setTimeout(() => {
      if (!this.pinned) this.controls.classList.add('is-faded');
    }, FADE_DELAY);
  }
}

function modeLabel(mode: Mode): string {
  return mode === 'flow' ? 'Flow' : 'Shape';
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}
