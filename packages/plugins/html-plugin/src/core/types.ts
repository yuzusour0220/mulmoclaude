/** Tool-call arguments for presentHtml. `html` and `path` are mutually
 *  exclusive (provide exactly one); `title` is an optional sidebar label. */
export interface HtmlArgs {
  html?: string;
  path?: string;
  title?: string;
}

/** Result payload that drives the View / preview sidebar. The HTML itself
 *  lives on disk (large), so only the workspace-relative `filePath` and an
 *  optional `title` travel in the tool result. */
export interface PresentHtmlData {
  title?: string;
  filePath: string;
}

/** Body of the in-place overwrite path (PUT /api/html/update). */
export interface UpdateHtmlArgs {
  relativePath: string;
  html: string;
}
