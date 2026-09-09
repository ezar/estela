/**
 * Ten seconds of canvas straight into the system share sheet.
 *
 * This is the part that decides whether the thing gets shared at all, so the
 * whole flow is one button: fixed length, no decision about when to stop, and
 * `navigator.share` with the file when the browser allows it.
 */

export const RECORDING_SECONDS = 10;

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

export interface RecorderCallbacks {
  onTick?: (secondsLeft: number) => void;
  onStart?: () => void;
  onFinish?: (outcome: 'shared' | 'downloaded') => void;
  onError?: (error: Error) => void;
}

export function isRecordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && pickMimeType() !== null;
}

function pickMimeType(): string | null {
  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

export class Recorder {
  private recorder: MediaRecorder | null = null;
  private timer: number | null = null;

  get isRecording(): boolean {
    return this.recorder !== null;
  }

  start(canvas: HTMLCanvasElement, callbacks: RecorderCallbacks = {}) {
    if (this.recorder) return;
    const mimeType = pickMimeType();
    if (!mimeType) {
      callbacks.onError?.(new Error('This browser cannot record the canvas.'));
      return;
    }

    const stream = canvas.captureStream(60);
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
    this.recorder = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      this.cleanUp(stream);
      const blob = new Blob(chunks, { type: mimeType });
      void deliver(blob, mimeType, callbacks);
    };
    recorder.onerror = () => {
      this.cleanUp(stream);
      callbacks.onError?.(new Error('Recording failed.'));
    };

    recorder.start();
    callbacks.onStart?.();

    let left = RECORDING_SECONDS;
    callbacks.onTick?.(left);
    this.timer = window.setInterval(() => {
      left -= 1;
      callbacks.onTick?.(left);
      if (left <= 0) this.stop();
    }, 1000);
  }

  stop() {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }

  private cleanUp(stream: MediaStream) {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const track of stream.getTracks()) track.stop();
    this.recorder = null;
  }
}

async function deliver(blob: Blob, mimeType: string, callbacks: RecorderCallbacks) {
  const extension = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  const name = `estela-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${extension}`;
  const file = new File([blob], name, { type: blob.type });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'estela' });
      callbacks.onFinish?.('shared');
      return;
    } catch (error) {
      // A cancelled share sheet is not a failure, and anything else falls
      // through to the download.
      if (error instanceof DOMException && error.name === 'AbortError') {
        callbacks.onFinish?.('shared');
        return;
      }
    }
  }

  download(file);
  callbacks.onFinish?.('downloaded');
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
