export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
const MAX_SIDE = 8192;

/** Preflight actual raster headers before invoking the browser image decoder. */
export function photoDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, size: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + size));
  let width = 0,
    height = 0;
  if (bytes.length >= 24 && bytes[0] === 137 && text(1, 3) === 'PNG' && text(12, 4) === 'IHDR') {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes.length >= 30 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    const kind = text(12, 4);
    if (kind === 'VP8X') {
      width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
      height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
    } else if (kind === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    } else if (kind === 'VP8L' && bytes[20] === 47) {
      const packed = view.getUint32(21, true);
      width = 1 + (packed & 0x3fff);
      height = 1 + ((packed >>> 14) & 0x3fff);
    }
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (offset < bytes.length && bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker) && length >= 7) {
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (!width || !height) throw new Error('Choose a JPEG, PNG or WebP photo.');
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS)
    throw new Error('Choose a smaller photo: up to 16 megapixels and 8192 pixels on either side.');
  return { width, height };
}

/** Local preview only. Re-encoding a small raster never retains source EXIF or file name. */
export async function photoCanvas(file: File, size: number): Promise<HTMLCanvasElement> {
  if (file.size > MAX_PHOTO_BYTES) throw new Error('Choose a photo smaller than 5 MB.');
  photoDimensions(new Uint8Array(await file.arrayBuffer()));
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    if (
      bitmap.width * bitmap.height > MAX_PIXELS ||
      Math.max(bitmap.width, bitmap.height) > MAX_SIDE
    )
      throw new Error('Choose a smaller photo.');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo preview is unavailable in this browser.');
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
    return canvas;
  } finally {
    bitmap.close();
  }
}

export async function previewPhoto(file: File): Promise<string> {
  return (await photoCanvas(file, 512)).toDataURL('image/png');
}
