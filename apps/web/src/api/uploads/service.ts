import { put } from "@vercel/blob";
import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";

import { HttpError, requireUser } from "../http";

/** Member photo uploads to Vercel Blob (ADR-0003). Admin/Editor only. */

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface UploadsDeps {
  db: Database;
  session: Session | null;
  blobToken: string | undefined;
}

export async function uploadPhoto(deps: UploadsDeps, request: Request) {
  requireUser(deps.session);
  if (!deps.blobToken) {
    throw new HttpError(503, "Photo storage is not configured — set BLOB_READ_WRITE_TOKEN");
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new HttpError(422, "Attach a photo file");
  if (!ALLOWED_TYPES.has(file.type)) throw new HttpError(422, "Only JPEG, PNG or WebP photos are accepted");
  if (file.size > MAX_BYTES) throw new HttpError(422, "Photo must be under 2 MB after resizing");

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const blob = await put(`members/${crypto.randomUUID()}.${extension}`, file, {
    access: "public",
    token: deps.blobToken,
  });
  return { url: blob.url };
}
