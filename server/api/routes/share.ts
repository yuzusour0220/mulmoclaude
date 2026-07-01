import { Router, Request, Response } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { packHtmlZip } from "../../utils/share/packHtml.js";
import { isHtmlPath } from "../../utils/files/html-store.js";
import { badRequest, serverError } from "../../utils/httpError.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";

const router = Router();

interface PackBody {
  path?: string;
}

// Route-boundary guard: only a canonical `.html` under artifacts/html is
// packable. Delegates to the repo's shared HTML path policy (`isHtmlPath`
// = prefix + `.html` ext + canonical form + no `..` + no traversal
// segment) so malformed input is a deterministic 400, never a 500 from
// deeper code.
export function isPackablePath(value: unknown): value is string {
  return typeof value === "string" && isHtmlPath(value);
}

// POST /api/share/pack — bundle an HTML artifact and its referenced
// local assets into a single self-contained zip (index.html + assets/),
// returned as a download. Paths are rewritten to be relative so the
// unzipped folder opens directly over file://.
router.post(API_ROUTES.share.pack, async (req: Request<object, unknown, PackBody>, res: Response) => {
  const htmlPath = req.body?.path;
  if (!isPackablePath(htmlPath)) {
    badRequest(res, `path must be a canonical ${WORKSPACE_DIRS.htmls}/*.html file`);
    return;
  }
  try {
    const { filename, zip } = await packHtmlZip(htmlPath);
    log.info("share", "pack: ok", { path: htmlPath, bytes: zip.length });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(zip);
  } catch (err) {
    // Log the detail server-side; return a generic message so an internal
    // path / stack never reaches the client.
    log.error("share", "pack: threw", { path: htmlPath, error: errorMessage(err) });
    serverError(res, "failed to pack HTML bundle");
  }
});

export default router;
