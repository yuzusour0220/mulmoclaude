import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripDataUri } from "../../server/utils/files/attachment-store.ts";

describe("attachment-store stripDataUri", () => {
  it("parses a plain base64 data URI", () => {
    assert.deepEqual(stripDataUri("data:image/png;base64,AAAA"), { mimeType: "image/png", base64: "AAAA" });
  });

  it("parses a data URI with media-type parameters (MediaRecorder output)", () => {
    // Regression: MediaRecorder + FileReader emit `;codecs=opus` between
    // the type and `;base64`. The parser must accept it (was a 400 on
    // /api/transcribe before the fix) and drop params from the MIME type.
    assert.deepEqual(stripDataUri("data:audio/webm;codecs=opus;base64,AAAA"), { mimeType: "audio/webm", base64: "AAAA" });
    assert.deepEqual(stripDataUri("data:audio/mp4;codecs=mp4a.40.2;base64,BBBB"), { mimeType: "audio/mp4", base64: "BBBB" });
  });

  it("URL-decodes the non-base64 inline form", () => {
    assert.deepEqual(stripDataUri("data:text/plain,hello%20world"), { mimeType: "text/plain", base64: Buffer.from("hello world", "utf-8").toString("base64") });
  });

  it("returns undefined for a non-data URI", () => {
    assert.equal(stripDataUri("not-a-data-uri"), undefined);
  });
});
