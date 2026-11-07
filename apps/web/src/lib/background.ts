import { waitUntil } from "@vercel/functions";

/**
 * Runs side-effect work without blocking the response. On Vercel, waitUntil
 * keeps the function alive after the response is sent; locally the dev process
 * stays up, so the promise simply runs on. Tests await the work so assertions
 * stay deterministic.
 */
export async function runAfterResponse(work: Promise<unknown>): Promise<void> {
  const guarded = work.catch((error) => console.error("background work failed", error));
  if (process.env.NODE_ENV === "test") {
    await guarded;
    return;
  }
  if (process.env.VERCEL) {
    waitUntil(guarded);
    return;
  }
  void guarded;
}