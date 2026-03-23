import { Jimp } from "jimp";
import type { ImageRef } from "./fetcher";

export interface KittyImage {
  pngBuffer: Buffer;
  alt: string;
  src: string;
  displayWidth: number;  // terminal columns to occupy
  displayHeight: number; // terminal rows to occupy
}

export async function prepareImage(
  img: ImageRef,
  maxWidth: number
): Promise<KittyImage | null> {
  try {
    const res = await fetch(img.src, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    const image = await Jimp.read(buffer);

    const origW = image.bitmap.width;
    const origH = image.bitmap.height;
    if (origW < 20 || origH < 20) return null;

    // Calculate display size in terminal cells
    // Each cell is roughly 10x20 pixels, so maxWidth cells = maxWidth*10 pixels
    const pixelWidth = maxWidth * 10;
    const aspectRatio = origH / origW;
    const pixelHeight = Math.round(pixelWidth * aspectRatio);

    // Clamp to reasonable size
    const maxPixelHeight = 600;
    const finalPixelW = pixelHeight > maxPixelHeight
      ? Math.round(maxPixelHeight / aspectRatio)
      : pixelWidth;
    const finalPixelH = pixelHeight > maxPixelHeight
      ? maxPixelHeight
      : pixelHeight;

    image.resize({ w: finalPixelW, h: finalPixelH });
    const pngBuffer = await image.getBuffer("image/png");

    const displayWidth = Math.ceil(finalPixelW / 10);
    const displayHeight = Math.ceil(finalPixelH / 20);

    return { pngBuffer, alt: img.alt, src: img.src, displayWidth, displayHeight };
  } catch {
    return null;
  }
}

// Write Kitty graphics protocol escape sequence to place image
export function writeKittyPlacement(img: KittyImage, row: number, col: number): void {
  const base64 = img.pngBuffer.toString("base64");

  // Delete any previous image with this ID
  process.stdout.write("\x1b_Ga=d,d=i,i=1\x1b\\");

  // Split into chunks and transmit+display
  const chunks: string[] = [];
  for (let i = 0; i < base64.length; i += 4096) {
    chunks.push(base64.slice(i, i + 4096));
  }

  // a=t = transmit and display, z=1 (on top of text), C=2 = move cursor to right
  const ctrl = `f=100,a=t,i=1,z=1,c=${img.displayWidth},r=${img.displayHeight},C=2`;

  for (let i = 0; i < chunks.length; i++) {
    const m = i < chunks.length - 1 ? 1 : 0;
    if (i === 0) {
      process.stdout.write(`\x1b_G${ctrl},m=${m};${chunks[i]}\x1b\\`);
    } else {
      process.stdout.write(`\x1b_Gm=${m};${chunks[i]}\x1b\\`);
    }
  }
}

// Move cursor to position and write Kitty image
export function placeImageAt(img: KittyImage, row: number, col: number): void {
  process.stdout.write(`\x1b[${row};${col}H`);
  writeKittyPlacement(img, row, col);
}
