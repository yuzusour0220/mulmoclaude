// Route test for the HEIC / HEIF / TIFF / BMP / AVIF → JPEG upload
// conversion (#1996). Injects a stub converter so the test never
// touches the native `sharp` binary. Confirms:
//   1. The upload response points the LLM at a `.jpg` companion but
//      keeps the original `.heic` path visible for the UI.
//   2. Response mimeType flips to `image/jpeg` for downstream code.
//   3. When the converter throws (sharp / libheif unavailable), the
//      route falls back to returning the original path unchanged.
//   4. The EXIF hook still fires against the ORIGINAL bytes (not the
//      JPEG), so GPS metadata is captured before conversion.

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type { Request, Response } from "express";

let workspaceRoot: string;
let originalHome: string | undefined;
let handler: (req: Request, res: Response) => Promise<void> | void;
let restoreConverter: (() => void) | null = null;
let unregisterHook: (() => void) | null = null;

// Records what the EXIF hook was called with so tests can assert the
// hook saw the ORIGINAL mimeType, not the JPEG.
interface CapturedHookCall {
  absPath: string;
  relativePath: string;
  mimeType: string;
}
let capturedHookCalls: CapturedHookCall[] = [];

interface RouterStackFrame {
  route?: {
    path: string;
    stack: { method: string; handle: (req: Request, res: Response) => Promise<void> | void }[];
  };
}
interface RouterInternals {
  stack: RouterStackFrame[];
}

function extractRouteHandler(mod: { default: unknown }, routePath: string, method: string) {
  const router = mod.default as unknown as RouterInternals;
  for (const frame of router.stack) {
    if (frame.route?.path !== routePath) continue;
    const layer = frame.route.stack.find((stackLayer) => stackLayer.method === method);
    if (layer) return layer.handle;
  }
  throw new Error(`route ${method.toUpperCase()} ${routePath} not registered`);
}

interface JsonResponsePayload {
  path?: string;
  originalPath?: string;
  mimeType?: string;
  error?: string;
}

function mockRes() {
  const state: { status: number; body: JsonResponsePayload | undefined } = {
    status: 200,
    body: undefined,
  };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(payload: JsonResponsePayload) {
      state.body = payload;
      return res;
    },
  };
  return { state, res: res as unknown as Response };
}

function buildDataUrl(mimeType: string, payload: string): string {
  const base64 = Buffer.from(payload, "utf-8").toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

// Stub JPEG bytes — content is arbitrary; the test only cares that
// they're returned and written verbatim. Real production sharp would
// emit a JPEG magic-number prefix here.
const STUB_JPEG_BYTES = Buffer.from("STUB-JPEG-BYTES", "utf-8");

before(async () => {
  workspaceRoot = await mkdtemp(path.join(tmpdir(), "mulmoclaude-heic-upload-"));
  originalHome = process.env.HOME;
  process.env.HOME = workspaceRoot;
  process.env.MULMOCLAUDE_WORKSPACE_PATH = workspaceRoot;
  const routeMod = await import("../../server/api/routes/attachment.ts");
  const apiRoutesMod = await import("../../src/config/apiRoutes.ts");
  handler = extractRouteHandler(routeMod as { default: unknown }, apiRoutesMod.API_ROUTES.attachments.upload, "post");
  // Register a hook so the "hook sees the original MIME" assertion
  // works. Kept module-scope so beforeEach can reset capturedHookCalls.
  const attachmentStore = await import("../../server/utils/files/attachment-store.ts");
  unregisterHook = attachmentStore.registerSaveAttachmentHook(async (absPath, relativePath, mimeType) => {
    capturedHookCalls.push({ absPath, relativePath, mimeType });
  });
});

after(async () => {
  if (unregisterHook) unregisterHook();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  delete process.env.MULMOCLAUDE_WORKSPACE_PATH;
  if (workspaceRoot) await rm(workspaceRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  capturedHookCalls = [];
  const routeMod = await import("../../server/api/routes/attachment.ts");
  const previous = routeMod.setImageJpegConverterForTests(async () => STUB_JPEG_BYTES);
  restoreConverter = () => {
    routeMod.setImageJpegConverterForTests(previous);
  };
});

afterEach(() => {
  if (restoreConverter) restoreConverter();
  restoreConverter = null;
});

describe("POST /api/attachments — HEIC → JPEG conversion (#1996)", () => {
  it("returns a .jpg companion path with the original .heic preserved", async () => {
    const req = {
      body: { dataUrl: buildDataUrl("image/heic", "fake-heic-bytes"), filename: "photo.heic" },
    } as unknown as Request;
    const { res, state } = mockRes();
    await handler(req, res);
    assert.equal(state.status, 200);
    assert.ok(state.body, "response body");
    assert.ok(state.body.path?.endsWith(".jpg"), `path ends with .jpg (got ${state.body.path})`);
    assert.ok(state.body.originalPath?.endsWith(".heic"), `originalPath ends with .heic (got ${state.body.originalPath})`);
    assert.equal(state.body.mimeType, "image/jpeg");
    // Both files land in the same partition + share the same id.
    const partition = path.posix.dirname(state.body.path);
    assert.equal(path.posix.dirname(state.body.originalPath), partition);
    const jpegId = path.posix.basename(state.body.path, ".jpg");
    const heicId = path.posix.basename(state.body.originalPath, ".heic");
    assert.equal(jpegId, heicId);
    // Companion bytes match what the stub returned.
    const onDisk = await readFile(path.join(workspaceRoot, state.body.path));
    assert.deepEqual(onDisk, STUB_JPEG_BYTES);
  });

  it("also converts HEIF / TIFF / BMP / AVIF", async () => {
    for (const mime of ["image/heif", "image/tiff", "image/bmp", "image/avif"]) {
      const req = { body: { dataUrl: buildDataUrl(mime, "fake-bytes") } } as unknown as Request;
      const { res, state } = mockRes();
      await handler(req, res);
      assert.equal(state.status, 200, `${mime} → 200`);
      assert.equal(state.body?.mimeType, "image/jpeg", `${mime} → response mimeType image/jpeg`);
      assert.ok(state.body?.path?.endsWith(".jpg"), `${mime} → path ends .jpg`);
    }
  });

  it("does NOT convert MIMEs Claude already accepts natively", async () => {
    for (const mime of ["image/jpeg", "image/png", "image/gif", "image/webp"]) {
      const req = { body: { dataUrl: buildDataUrl(mime, "already-fine") } } as unknown as Request;
      const { res, state } = mockRes();
      await handler(req, res);
      assert.equal(state.status, 200, `${mime} → 200`);
      assert.equal(state.body?.mimeType, mime, `${mime} → mimeType preserved`);
      assert.equal(state.body?.path, state.body?.originalPath, `${mime} → path === originalPath (no companion)`);
    }
  });

  it("falls back to the original path when the converter throws", async () => {
    // Swap in a converter that fails, mirroring "libheif missing" /
    // "corrupted HEIC" scenarios. The route must still succeed so the
    // upload isn't lost — the caller then hits the same 400 downstream
    // it would have hit without this branch.
    const routeMod = await import("../../server/api/routes/attachment.ts");
    const previous = routeMod.setImageJpegConverterForTests(async () => {
      throw new Error("libheif unavailable");
    });
    try {
      const req = { body: { dataUrl: buildDataUrl("image/heic", "will-fail") } } as unknown as Request;
      const { res, state } = mockRes();
      await handler(req, res);
      assert.equal(state.status, 200);
      assert.ok(state.body?.path?.endsWith(".heic"), "fallback path retains .heic");
      assert.equal(state.body?.path, state.body?.originalPath, "path === originalPath on fallback");
      assert.equal(state.body?.mimeType, "image/heic", "mimeType preserved on fallback");
    } finally {
      routeMod.setImageJpegConverterForTests(previous);
    }
  });

  it("EXIF hook fires against the ORIGINAL HEIC bytes (not the JPEG)", async () => {
    const req = { body: { dataUrl: buildDataUrl("image/heic", "iphone-photo") } } as unknown as Request;
    const { res } = mockRes();
    await handler(req, res);
    // Multiple tests can bank hook calls; find the HEIC one from this
    // invocation. Only `saveAttachment` fires the hook — `saveCompanion`
    // does not — so exactly one hook call for `image/heic` is expected
    // and NONE for `image/jpeg`.
    const heicCalls = capturedHookCalls.filter((call) => call.mimeType === "image/heic");
    const jpegCalls = capturedHookCalls.filter((call) => call.mimeType === "image/jpeg");
    assert.ok(heicCalls.length >= 1, "hook saw at least one image/heic call");
    assert.equal(jpegCalls.length, 0, "hook was NOT fired for the JPEG companion");
    const latest = heicCalls[heicCalls.length - 1];
    assert.ok(latest.relativePath.endsWith(".heic"), "hook received .heic path");
  });
});

describe("POST /api/attachments — request-shape guards (regression)", () => {
  it("400s on missing dataUrl", async () => {
    const req = { body: {} } as unknown as Request;
    const { res, state } = mockRes();
    // The route uses badRequest(res, ...) which sets status(400) then json({error}).
    await handler(req, res);
    assert.equal(state.status, 400);
    assert.ok(state.body?.error, "error field present");
  });

  it("400s on a non-data URI", async () => {
    const req = { body: { dataUrl: "https://example.com/photo.heic" } } as unknown as Request;
    const { res, state } = mockRes();
    await handler(req, res);
    assert.equal(state.status, 400);
    assert.ok(state.body?.error, "error field present");
  });
});
