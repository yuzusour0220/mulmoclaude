// Unit tests for the phase-4 writable remote-view surface: the shared
// createMutateRemoteView builder (io stubbed) and the mutateRemoteViewItem
// command handler over it. See plans/feat-remote-writable-view.md.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createMutateRemoteView, mutateRemoteViewFailureMessage, type MutateRemoteViewDeps } from "../../server/workspace/collections/remoteView.js";
import { createMutateRemoteViewHandler, type MutateRemoteViewHandlerDeps } from "../../server/remoteHost/handlers/mutateRemoteView.js";
import { handlers } from "../../server/remoteHost/handlers/index.js";
import type { LoadedCollection } from "../../server/workspace/collections/index.js";

const collection = (views: unknown[]): LoadedCollection =>
  ({
    slug: "todos",
    source: "project",
    skillDir: "/s/todos",
    dataDir: "/d/todos",
    schema: { primaryKey: "id", fields: {}, views },
  }) as unknown as LoadedCollection;

// A view that may toggle `done` and delete records.
const writableView = { id: "phone", label: "Todos", target: "mobile", file: "views/phone.html", editableFields: ["done"], allowDelete: true };

const record = { id: "t1", title: "buy milk", done: false };

const deps = (overrides: Partial<MutateRemoteViewDeps> = {}): MutateRemoteViewDeps => ({
  readItem: (async () => ({ ...record })) as unknown as MutateRemoteViewDeps["readItem"],
  writeItem: (async (_dir: string, itemId: string, item: unknown) => ({ kind: "ok", itemId, item })) as unknown as MutateRemoteViewDeps["writeItem"],
  deleteItem: (async (_dir: string, itemId: string) => ({ kind: "ok", itemId })) as unknown as MutateRemoteViewDeps["deleteItem"],
  ...overrides,
});

describe("createMutateRemoteView", () => {
  it("updates a whitelisted field, merging the patch onto the existing record", async () => {
    let written: unknown;
    const mutate = createMutateRemoteView(
      deps({
        writeItem: (async (_dir: string, itemId: string, item: unknown) => (
          (written = item),
          { kind: "ok", itemId, item }
        )) as unknown as MutateRemoteViewDeps["writeItem"],
      }),
    );
    const result = await mutate(collection([writableView]), "phone", { op: "update", id: "t1", patch: { done: true } });
    assert.deepEqual(result, { kind: "ok", op: "update", item: { id: "t1", title: "buy milk", done: true } });
    // The patch merges — untouched fields survive, id is pinned to the URL id.
    assert.deepEqual(written, { id: "t1", title: "buy milk", done: true });
  });

  it("deletes a record when allowDelete is set", async () => {
    const result = await createMutateRemoteView(deps())(collection([writableView]), "phone", { op: "delete", id: "t1" });
    assert.deepEqual(result, { kind: "ok", op: "delete", id: "t1" });
  });

  it("refuses a patch touching a non-whitelisted field (and the primary key)", async () => {
    const mutate = createMutateRemoteView(deps());
    assert.deepEqual(await mutate(collection([writableView]), "phone", { op: "update", id: "t1", patch: { title: "x" } }), {
      kind: "field-not-editable",
      field: "title",
    });
    assert.deepEqual(await mutate(collection([writableView]), "phone", { op: "update", id: "t1", patch: { id: "hacked" } }), {
      kind: "field-not-editable",
      field: "id",
    });
  });

  it("refuses an empty patch and a missing record", async () => {
    assert.deepEqual(await createMutateRemoteView(deps())(collection([writableView]), "phone", { op: "update", id: "t1", patch: {} }), {
      kind: "invalid-patch",
    });
    const noItem = createMutateRemoteView(deps({ readItem: (async () => null) as unknown as MutateRemoteViewDeps["readItem"] }));
    assert.deepEqual(await noItem(collection([writableView]), "phone", { op: "update", id: "ghost", patch: { done: true } }), {
      kind: "item-not-found",
      id: "ghost",
    });
  });

  it("refuses delete when allowDelete is absent, and update when no editableFields", async () => {
    const deleteOnly = { id: "phone", label: "P", target: "mobile", file: "views/phone.html", allowDelete: true };
    const updateOnly = { id: "phone", label: "P", target: "mobile", file: "views/phone.html", editableFields: ["done"] };
    assert.deepEqual(await createMutateRemoteView(deps())(collection([updateOnly]), "phone", { op: "delete", id: "t1" }), { kind: "delete-not-allowed" });
    // A delete-only view exposes no editable field, so any update key is refused.
    assert.deepEqual(await createMutateRemoteView(deps())(collection([deleteOnly]), "phone", { op: "update", id: "t1", patch: { done: true } }), {
      kind: "field-not-editable",
      field: "done",
    });
  });

  it("refuses a read-only mobile view, a desktop view, and an unknown view", async () => {
    const readOnly = { id: "phone", label: "P", target: "mobile", file: "views/phone.html" };
    const desktop = { id: "year", label: "Y", file: "views/year.html", editableFields: ["done"] };
    const mutate = createMutateRemoteView(deps());
    assert.deepEqual(await mutate(collection([readOnly]), "phone", { op: "delete", id: "t1" }), { kind: "not-writable", viewId: "phone" });
    assert.deepEqual(await mutate(collection([desktop]), "year", { op: "delete", id: "t1" }), { kind: "not-mobile", viewId: "year" });
    assert.deepEqual(await mutate(collection([writableView]), "ghost", { op: "delete", id: "t1" }), { kind: "view-not-found", viewId: "ghost" });
  });

  it("maps every failure kind to an actionable message", () => {
    assert.match(mutateRemoteViewFailureMessage({ kind: "view-not-found", viewId: "phone" }, "todos"), /'phone' not found on collection 'todos'/);
    assert.match(mutateRemoteViewFailureMessage({ kind: "not-mobile", viewId: "year" }, "todos"), /target: "mobile"/);
    assert.match(mutateRemoteViewFailureMessage({ kind: "not-writable", viewId: "phone" }, "todos"), /read-only — declare editableFields/);
    assert.match(mutateRemoteViewFailureMessage({ kind: "field-not-editable", field: "title" }, "todos"), /'title' is not editable/);
    assert.match(mutateRemoteViewFailureMessage({ kind: "delete-not-allowed" }, "todos"), /allowDelete: true/);
    assert.match(mutateRemoteViewFailureMessage({ kind: "invalid-patch" }, "todos"), /non-empty object/);
    assert.match(mutateRemoteViewFailureMessage({ kind: "item-not-found", id: "t9" }, "todos"), /'t9' not found/);
    assert.match(mutateRemoteViewFailureMessage({ kind: "invalid-id", id: "bad/id" }, "todos"), /invalid item id: bad\/id/);
    assert.match(mutateRemoteViewFailureMessage({ kind: "path-escape" }, "todos"), /escapes the workspace/);
  });
});

describe("createMutateRemoteViewHandler", () => {
  const handlerDeps = (overrides: Partial<MutateRemoteViewHandlerDeps> = {}): MutateRemoteViewHandlerDeps => ({
    loadCollection: (async (slug: string) =>
      slug === "missing" ? null : collection([writableView])) as unknown as MutateRemoteViewHandlerDeps["loadCollection"],
    mutateRemoteView: (async () => ({
      kind: "ok",
      op: "update",
      item: { id: "t1", done: true },
    })) as unknown as MutateRemoteViewHandlerDeps["mutateRemoteView"],
    ...overrides,
  });

  it("returns the update result for a valid request", async () => {
    const handler = createMutateRemoteViewHandler(handlerDeps());
    assert.deepEqual(await handler({ slug: "todos", viewId: "phone", op: "update", id: "t1", patch: { done: true } }), {
      op: "update",
      item: { id: "t1", done: true },
    });
  });

  it("returns the delete result shape", async () => {
    const handler = createMutateRemoteViewHandler(
      handlerDeps({ mutateRemoteView: (async () => ({ kind: "ok", op: "delete", id: "t1" })) as unknown as MutateRemoteViewHandlerDeps["mutateRemoteView"] }),
    );
    assert.deepEqual(await handler({ slug: "todos", viewId: "phone", op: "delete", id: "t1" }), { op: "delete", id: "t1" });
  });

  it("throws on a malformed request, an unknown collection, and a non-ok mutate", async () => {
    await assert.rejects(
      async () => createMutateRemoteViewHandler(handlerDeps())({ slug: "todos", viewId: "phone", op: "wipe", id: "t1" }),
      /invalid mutate request/,
    );
    await assert.rejects(
      async () => createMutateRemoteViewHandler(handlerDeps())({ slug: "missing", viewId: "phone", op: "delete", id: "t1" }),
      /collection 'missing' not found/,
    );
    const rejecting = createMutateRemoteViewHandler(
      handlerDeps({ mutateRemoteView: (async () => ({ kind: "delete-not-allowed" })) as unknown as MutateRemoteViewHandlerDeps["mutateRemoteView"] }),
    );
    await assert.rejects(async () => rejecting({ slug: "todos", viewId: "phone", op: "delete", id: "t1" }), /allowDelete: true/);
  });

  it("is registered in the runner's method table", () => {
    assert.equal(typeof handlers.mutateRemoteViewItem, "function");
  });
});
