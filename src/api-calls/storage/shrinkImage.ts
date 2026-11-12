import { MAX_FILE_SIZE } from "./imageLimits";

/**
 * Browser-side image shrinking for uploads. Images are served as uploaded
 * (the stack has no image resizer), so large images are shrunk in the browser
 * first. Pure dimension math stays testable in node; the bitmap path falls
 * back to the original file wherever browser image APIs are missing.
 */

export const MAX_UPLOAD_DIMENSION = 1024;

export function computeShrunkDimensions(
  width: number,
  height: number,
  maxDimension: number = MAX_UPLOAD_DIMENSION
): { width: number; height: number } {
  if (
    width <= 0 ||
    height <= 0 ||
    (width <= maxDimension && height <= maxDimension)
  ) {
    return { width, height };
  }
  const scale = maxDimension / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canShrinkInThisEnvironment(): boolean {
  return (
    typeof createImageBitmap === "function" &&
    typeof document !== "undefined" &&
    typeof document.createElement === "function"
  );
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string
): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => resolve(blob), type, 0.85);
      return;
    }
    resolve(null);
  });
}

/**
 * Shrinks a large image in the browser before upload. Images that already
 * fit within the dimension and size limits are returned untouched; anything
 * else is redrawn at a smaller size. Never rejects: when shrinking is
 * impossible, the original file goes up as-is.
 */
export async function shrinkImageFile(
  file: File,
  maxDimension: number = MAX_UPLOAD_DIMENSION
): Promise<File> {
  if (!canShrinkInThisEnvironment()) {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = computeShrunkDimensions(
      bitmap.width,
      bitmap.height,
      maxDimension
    );
    const alreadySmall =
      width === bitmap.width && height === bitmap.height;
    bitmap.close?.();
    if (alreadySmall && file.size <= MAX_FILE_SIZE) {
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      return file;
    }
    const fresh = await createImageBitmap(file);
    context.drawImage(fresh, 0, 0, width, height);
    fresh.close?.();
    const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await canvasToBlob(canvas, outputType);
    if (!blob) {
      return file;
    }
    return new File([blob], file.name, { type: blob.type || outputType });
  } catch (error) {
    console.error(error);
    return file;
  }
}
