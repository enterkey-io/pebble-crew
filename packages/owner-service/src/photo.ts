export const OWNER_PHOTO_SIDE = 192;
export const OWNER_PHOTO_BYTES = OWNER_PHOTO_SIDE * OWNER_PHOTO_SIDE * 4;
export const OWNER_PHOTO_BODY_LIMIT = 200 * 1024;

export function ownerBodyLimit(path: string, method: string) {
  return path === '/api/owner/photo' && method === 'POST' ? OWNER_PHOTO_BODY_LIMIT : 8192;
}

export function base64Bytes(bytes: Uint8Array | Uint8ClampedArray) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}

export function ownerPhotoValue(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length <= OWNER_PHOTO_BODY_LIMIT &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
    ? value
    : null;
}

export function photoPixels(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).join(',') !== 'pixels' ||
    !('pixels' in value)
  )
    throw new Error('Choose a photo');
  if (value.pixels === null) return null;
  if (
    typeof value.pixels !== 'string' ||
    value.pixels.length !== (OWNER_PHOTO_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]+$/.test(value.pixels)
  )
    throw new Error('Invalid photo pixels');
  return Uint8Array.from(atob(value.pixels), (character) => character.charCodeAt(0));
}

const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function pngChunk(kind: string, data: Uint8Array) {
  const bytes = new Uint8Array(data.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(kind), 4);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, bytes.length - 4))
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}

/** The wire input is an exact-size raster, never a browser-supplied encoded image. */
export async function encodeOwnerPhoto(pixels: Uint8Array<ArrayBuffer>): Promise<string> {
  if (pixels.length !== OWNER_PHOTO_BYTES) throw new Error('Invalid photo pixels');
  const stride = OWNER_PHOTO_SIDE * 4;
  const scanlines = new Uint8Array((stride + 1) * OWNER_PHOTO_SIDE);
  for (let row = 0; row < OWNER_PHOTO_SIDE; row++)
    scanlines.set(pixels.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  const compressed = new Uint8Array(
    await new Response(
      new Blob([scanlines]).stream().pipeThrough(new CompressionStream('deflate')),
    ).arrayBuffer(),
  );
  const header = new Uint8Array(13);
  const dimensions = new DataView(header.buffer);
  dimensions.setUint32(0, OWNER_PHOTO_SIDE);
  dimensions.setUint32(4, OWNER_PHOTO_SIDE);
  header[8] = 8;
  header[9] = 6;
  const chunks = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', new Uint8Array()),
  ];
  const png = new Uint8Array(chunks.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  return 'data:image/png;base64,' + base64Bytes(png);
}
