import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { setupTestDb, resetDb } from "@DreamDev/db/test/harness";
import { monthOfDate } from "@DreamDev/db/domain/month";

import { sessionFor } from "../test-support";
import { createMember, updateMember } from "../members/service";
import { uploadPhoto } from "./service";

let db: Database;
let admin: Session;
let editor: Session;

function photoRequest(type = "image/jpeg", size = 1000): Request {
  const form = new FormData();
  const file = type ? new File([new Uint8Array(size)], "photo.jpg", { type }) : new File([new Uint8Array(size)], "photo-untyped");
  form.append("file", file);
  return new Request("http://x/api/uploads", { method: "POST", body: form });
}

beforeAll(async () => {
  db = await setupTestDb();
  admin = sessionFor({ id: "admin-1", role: "admin" });
  editor = sessionFor({ id: "editor-1", role: "editor" });
});

beforeEach(async () => {
  await resetDb();
});

describe("photo uploads", () => {
  test("requires authentication", async () => {
    await expect(uploadPhoto({ db, session: null, blobToken: "tok" }, photoRequest())).rejects.toMatchObject({ status: 401 });
  });

  test("clear 503 when Blob storage is not configured (everything else still works)", async () => {
    await expect(uploadPhoto({ db, session: editor, blobToken: undefined }, photoRequest())).rejects.toMatchObject({ status: 503 });
  });

  test("validates the attached file", async () => {
    // No MIME type → rejected before any Blob call (hermetic: no network)
    await expect(uploadPhoto({ db, session: editor, blobToken: "tok" }, photoRequest(""))).rejects.toMatchObject({ status: 422 });
    await expect(
      uploadPhoto({ db, session: editor, blobToken: "tok" }, new Request("http://x/api/uploads", { method: "POST", body: "not-form" })),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("photo URL round-trips through the Member", async () => {
    const thisMonth = monthOfDate(new Date());
    const created = await createMember(
      { db, session: admin },
      { name: "Rahim", mobile: "01712345678", joiningDate: `${thisMonth}-01`, shareQuantity: 1, photo: "https://example.blob.vercel-storage.com/members/x.jpg" },
    );
    expect(created.photo).toContain("blob.vercel-storage");

    const removed = await updateMember({ db, session: admin }, created.id, { photo: null });
    expect(removed.photo).toBeNull();
  });
});
