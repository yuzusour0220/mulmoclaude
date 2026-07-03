// Unit tests for the remote-host image ingest. The Firebase Storage + attachment
// store deps are stubbed so the test asserts the flow — Storage path
// composition, save→delete ordering, the returned path-only Attachments, and the
// reject paths — not that real bytes move.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createIngestImages, type IngestDeps } from "../../server/remoteHost/handlers/ingestImages.js";

// Recording stub deps. `fetchObject` returns canned bytes + an image/jpeg type;
// `saveAttachment` hands back a deterministic relativePath; every call is logged
// so tests can assert path composition and ordering. `over` swaps in behaviours.
const makeDeps = (over: Partial<IngestDeps> = {}) => {
  const fetched: string[] = [];
  const saved: { base64: string; mimeType: string }[] = [];
  const deleted: string[] = [];
  const deps: IngestDeps = {
    uid: () => "user-1",
    fetchObject: async (storagePath) => {
      fetched.push(storagePath);
      return { base64: `bytes(${storagePath})`, contentType: "image/jpeg" };
    },
    saveAttachment: async (base64, mimeType) => {
      saved.push({ base64, mimeType });
      return { relativePath: `data/attachments/2026/07/${saved.length}.jpg`, mimeType };
    },
    deleteObject: async (storagePath) => {
      deleted.push(storagePath);
    },
    ...over,
  };
  return { deps, fetched, saved, deleted };
};

describe("createIngestImages", () => {
  it("no-ops on empty input — no uid lookup, no Storage calls", async () => {
    let uidCalls = 0;
    const { deps, fetched } = makeDeps({
      uid: () => {
        uidCalls++;
        return "user-1";
      },
    });
    assert.deepEqual(await createIngestImages(deps)([]), []);
    assert.equal(fetched.length, 0);
    assert.equal(uidCalls, 0);
  });

  it("builds users/{uid}/uploads/{id}, saves the bytes, returns path-only Attachments", async () => {
    const { deps, fetched, saved } = makeDeps();
    const result = await createIngestImages(deps)(["aaa", "bbb"]);
    assert.deepEqual(fetched, ["users/user-1/uploads/aaa", "users/user-1/uploads/bbb"]);
    assert.deepEqual(
      saved.map((rec) => rec.base64),
      ["bytes(users/user-1/uploads/aaa)", "bytes(users/user-1/uploads/bbb)"],
    );
    assert.deepEqual(result, [
      { path: "data/attachments/2026/07/1.jpg", mimeType: "image/jpeg" },
      { path: "data/attachments/2026/07/2.jpg", mimeType: "image/jpeg" },
    ]);
  });

  it("deletes each Storage object only AFTER its bytes are saved", async () => {
    const order: string[] = [];
    const { deps } = makeDeps({
      saveAttachment: async (_base64, mimeType) => {
        order.push("save");
        return { relativePath: "data/attachments/2026/07/x.jpg", mimeType };
      },
      deleteObject: async () => {
        order.push("delete");
      },
    });
    await createIngestImages(deps)(["aaa"]);
    assert.deepEqual(order, ["save", "delete"]);
  });

  it("rejects when the host is not signed in, without touching Storage", async () => {
    const { deps, fetched } = makeDeps({ uid: () => null });
    await assert.rejects(async () => createIngestImages(deps)(["aaa"]), /not signed in/);
    assert.equal(fetched.length, 0);
  });

  it("rejects a malformed storage_id before touching Storage", async () => {
    const { deps, fetched } = makeDeps();
    await assert.rejects(async () => createIngestImages(deps)(["../evil"]), /invalid storage_id/);
    await assert.rejects(async () => createIngestImages(deps)(["a/b"]), /invalid storage_id/);
    assert.equal(fetched.length, 0);
  });

  it("propagates a download failure — rejects the batch, deletes nothing", async () => {
    const { deps, deleted } = makeDeps({
      fetchObject: async () => {
        throw new Error("storage 404");
      },
    });
    await assert.rejects(async () => createIngestImages(deps)(["aaa"]), /storage 404/);
    assert.equal(deleted.length, 0);
  });
});
