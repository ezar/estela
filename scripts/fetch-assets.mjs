/**
 * Copies the MediaPipe wasm runtime out of node_modules and downloads the hand
 * landmarker model into `public/`, so the app never depends on a CDN at runtime.
 *
 * Both destinations are gitignored: this runs before `dev` and `build`.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, copyFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const MODEL_PATH = join(root, 'public/models/hand_landmarker.task');
const WASM_DEST = join(root, 'public/wasm');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyWasm() {
  const src = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
  if (!(await exists(src))) {
    throw new Error('assets: @mediapipe/tasks-vision is not installed, run `npm install` first');
  }
  await mkdir(WASM_DEST, { recursive: true });
  const files = await readdir(src);
  for (const file of files) {
    await copyFile(join(src, file), join(WASM_DEST, file));
  }
  console.log(`assets: copied ${files.length} wasm files to public/wasm`);
}

async function download(url, dest) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    return;
  } catch (error) {
    // Environments behind a proxy often need curl, which honours the proxy env vars.
    console.warn(`assets: fetch failed (${String(error)}), retrying with curl`);
    execFileSync('curl', ['-fsSL', '-o', dest, url], { stdio: 'inherit' });
  }
}

async function fetchModel() {
  if (await exists(MODEL_PATH)) {
    console.log('assets: model already present');
    return;
  }
  await mkdir(dirname(MODEL_PATH), { recursive: true });
  console.log('assets: downloading hand_landmarker.task');
  await download(MODEL_URL, MODEL_PATH);
  const { size } = await stat(MODEL_PATH);
  console.log(`assets: model ready (${(size / 1e6).toFixed(1)} MB)`);
}

await copyWasm();
await fetchModel();
