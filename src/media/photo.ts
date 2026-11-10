export interface PreparedPhoto {
  blob: Blob;
  width: number;
  height: number;
  sha256: string;
}

export async function decodeImage(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return image;
  } catch {
    throw new Error('No se pudo abrir la imagen. Prueba con un JPEG, PNG o WebP.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function encodeWebp(canvas: HTMLCanvasElement, maxBytes: number): Promise<PreparedPhoto | null> {
  // El lienzo vuelve a codificar los píxeles y descarta los metadatos del archivo original.
  for (const quality of [0.88, 0.74, 0.60, 0.46, 0.32, 0.18, 0.06]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob || blob.type !== 'image/webp') throw new Error('Este navegador no puede exportar WebP.');
    if (blob.size > maxBytes) continue;
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return { blob, sha256, width: canvas.width, height: canvas.height };
  }
  return null;
}

export async function prepareIncidentPhoto(file: File, signal: AbortSignal): Promise<PreparedPhoto> {
  const image = await decodeImage(file);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo preparar el lienzo.');
  const longSide = Math.max(image.naturalWidth, image.naturalHeight);
  const initial = Math.max(800, Math.min(1600, longSide));
  for (const size of new Set([initial, Math.min(initial, 1200), Math.min(initial, 1000), 800])) {
    signal.throwIfAborted();
    canvas.width = Math.max(1, Math.round(image.naturalWidth * size / longSide));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * size / longSide));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = await encodeWebp(canvas, 300 * 1024);
    if (result) return result;
  }
  throw new Error('La foto supera el límite de 300 KB. Prueba con una imagen distinta.');
}
