import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCspViolationMessage } from "../../src/composables/useCspViolations";

describe("parseCspViolationMessage", () => {
  it("extracts the blocked origin + directive from a valid message", () => {
    const out = parseCspViolationMessage({
      type: "mc-csp-violation",
      blockedURI: "https://www.google.com/maps/embed?pb=xyz",
      violatedDirective: "frame-src",
    });
    assert.deepEqual(out, { host: "https://www.google.com", directive: "frame-src" });
  });

  it("takes only the directive name when the value carries a source list", () => {
    const out = parseCspViolationMessage({
      type: "mc-csp-violation",
      blockedURI: "https://maps.googleapis.com/x",
      effectiveDirective: "script-src 'unsafe-inline'",
    });
    assert.equal(out?.directive, "script-src");
    assert.equal(out?.host, "https://maps.googleapis.com");
  });

  it("returns null for non-violation messages", () => {
    assert.equal(parseCspViolationMessage({ type: "mc-open-item" }), null);
    assert.equal(parseCspViolationMessage(null), null);
    assert.equal(parseCspViolationMessage("nope"), null);
  });

  it("ignores inline/eval violations (not fixable by adding a host)", () => {
    assert.equal(parseCspViolationMessage({ type: "mc-csp-violation", blockedURI: "inline", violatedDirective: "script-src" }), null);
    assert.equal(parseCspViolationMessage({ type: "mc-csp-violation", blockedURI: "eval", violatedDirective: "script-src" }), null);
    assert.equal(parseCspViolationMessage({ type: "mc-csp-violation", blockedURI: "", violatedDirective: "script-src" }), null);
  });

  it("falls back to the raw URI as host when it isn't a parseable URL", () => {
    const out = parseCspViolationMessage({ type: "mc-csp-violation", blockedURI: "notaurl", violatedDirective: "img-src" });
    assert.equal(out?.host, "notaurl");
  });
});
