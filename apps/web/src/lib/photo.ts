/**
 * Client-side photo preparation (ADR-0003): resize to a 512px square cover
 * crop as JPEG, well under the 2 MB cap. Failures never block the rest of the
 * form — they reject with a readable message.
 */
const SIZE = 512;
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function prepareProfilePhoto(file: File): Promise<Blob> {
  if (!ALLOWED.has(file.type)) {
    throw new Error("Only JPEG, PNG or WebP photos are accepted");
  }

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Could not read that photo — try another file");
  });

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not process the photo");

  // Cover-crop to a square, centred
  const side = Math.min(bitmap.width, bitmap.height);
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
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Could not process the photo");
  if (blob.size > MAX_BYTES) throw new Error("Photo is too large even after resizing — pick a smaller image");
  return blob;
}

/** Uploads a prepared photo and returns its public Blob URL. */
export async function uploadProfilePhoto(file: File): Promise<string> {
  const prepared = await prepareProfilePhoto(file);
  const body = new FormData();
  body.append("file", new File([prepared], "photo.jpg", { type: "image/jpeg" }));
  const response = await fetch("/api/uploads", { method: "POST", body });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(error?.error ?? "Photo upload failed");
  }
  const { url } = (await response.json()) as { url: string };
  return url;
}
