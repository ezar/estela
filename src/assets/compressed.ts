/**
 * Fetching the big MediaPipe assets.
 *
 * The wasm runtime and the model are 19 MB between them, and GitHub Pages
 * serves files exactly as it is given them: there is no way to set
 * `Content-Encoding`, so the usual answer of letting the server compress is not
 * available. No browser exposes Brotli decompression either, `DecompressionStream`
 * only does gzip and deflate, so the app carries a 208 KB decoder and unpacks
 * the `.br` files itself. That trades 0.2 MB for 11.5 MB.
 *
 * The uncompressed original is the fallback for anything that goes wrong.
 */

/** Decompressed bytes of `url`, preferring the Brotli copy sitting next to it. */
export async function fetchAsset(url: string): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const response = await fetch(`${url}.br`);
    if (response.ok) {
      // Loaded on demand so the decoder is not on the critical path for anyone
      // who never gets as far as turning the camera on.
      const { decompress } = await (await import('brotli-dec-wasm')).default;
      // Copied out of the decoder's own memory, which it is free to reuse.
      return new Uint8Array(decompress(new Uint8Array(await response.arrayBuffer())));
    }
  } catch {
    // Falls through to the uncompressed copy.
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
