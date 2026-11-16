import { Injectable } from '@angular/core';

const SIZE = 256;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** Turns a chosen photo into a small square JPEG that is cheap to store and sync. */
@Injectable({ providedIn: 'root' })
export class ProfilePhotoService {
  async prepare(file: File): Promise<string> {
    if (!file.type.startsWith('image/')) {
      throw new Error('Choose a photo (JPEG, PNG, or WebP).');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new Error('That photo is too large. Choose one under 15 MB.');
    }
    const bitmap = await this.decode(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This device cannot prepare the photo.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, SIZE, SIZE);
    // Centre-crop to a square so faces are not squashed.
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      SIZE,
      SIZE,
    );
    return canvas.toDataURL('image/jpeg', 0.82);
  }

  /** A readable (not square) copy of a document photo, kept small enough to upload. */
  async prepareDocument(file: File): Promise<string> {
    if (!file.type.startsWith('image/')) {
      throw new Error('Choose a photo (JPEG, PNG, or WebP).');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new Error('That photo is too large. Choose one under 15 MB.');
    }
    const bitmap = await this.decode(file);
    const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This device cannot prepare the photo.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // Lower the quality until it fits the server limit.
    for (const quality of [0.75, 0.6, 0.45]) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.length <= 240_000) return data;
    }
    throw new Error('That photo is too detailed to upload. Try a closer photo.');
  }

  private async decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      return new Promise<HTMLImageElement>((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('That file could not be read as a photo.'));
        };
        image.src = url;
      });
    }
  }
}
