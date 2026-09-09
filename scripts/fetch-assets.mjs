/**
 * Copies the MediaPipe wasm runtime out of node_modules and downloads the hand
 * landmarker model into `public/`, so the app never depends on a CDN at runtime.
 *
 * Both destinations are gitignored: this runs before `dev` and `build`.
 */
import { execFileSync } from 'node:child_process';
import { brotliCompress, constants } from 'node:zlib';
import { mkdir, readdir, copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compress = promisify(brotliCompress);
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

/** Files the browser actually downloads, and so the only ones worth squeezing. */
const COMPRESSIBLE = [
  join(WASM_DEST, 'vision_wasm_internal.wasm'),
  join(WASM_DEST, 'vision_wasm_nosimd_internal.wasm'),
  MODEL_PATH,
];

async function compressAssets() {
  for (const source of COMPRESSIBLE) {
    const destination = `${source}.br`;
    if (!(await exists(source))) continue;
    const [sourceStat, destinationStat] = await Promise.all([stat(source), safeStat(destination)]);
    if (destinationStat && destinationStat.mtimeMs >= sourceStat.mtimeMs) continue;

    const raw = await readFile(source);
    const started = Date.now();
    const packed = await compress(raw, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    });
    await writeFile(destination, packed);
    const saved = ((1 - packed.length / raw.length) * 100).toFixed(0);
    const seconds = ((Date.now() - started) / 1000).toFixed(0);
    console.log(
      `assets: ${basename(source)} ${(raw.length / 1e6).toFixed(1)} MB to ` +
        `${(packed.length / 1e6).toFixed(1)} MB, ${saved}% off, ${seconds}s`,
    );
  }
}

async function safeStat(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

await copyWasm();
await fetchModel();
await compressAssets();
