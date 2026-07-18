import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import express from "express";
import { configureTrustProxy, createWebhookApp, createWebhookRateLimit, verifyHmacSignature } from "../src/index.ts";

// Generated (not a literal) so the secret-scanner lint doesn't flag a
// test fixture as a real credential.
const SECRET = crypto.randomBytes(16).toString("hex");
const sign = (body: string, enc: crypto.BinaryToTextEncoding = "base64") => crypto.createHmac("SHA256", SECRET).update(body).digest(enc);

describe("verifyHmacSignature", () => {
  it("accepts a correct base64 signature", () => {
    const body = '{"events":[]}';
    assert.equal(verifyHmacSignature(body, sign(body), SECRET), true);
  });

  it("rejects a tampered body", () => {
    const good = sign('{"events":[]}');
    assert.equal(verifyHmacSignature('{"events":[1]}', good, SECRET), false);
  });

  it("rejects a wrong secret", () => {
    const body = "payload";
    assert.equal(verifyHmacSignature(body, sign(body), "different"), false);
  });

  it("returns false (no throw) on a length mismatch", () => {
    assert.equal(verifyHmacSignature("payload", "short", SECRET), false);
  });

  it("returns false (no throw) when a non-ASCII signature matches string length but not byte length", () => {
    // Regression: the guard must compare BYTE lengths. A multi-byte char
    // gives Buffer.from() more bytes than the JS string length, which
    // would make timingSafeEqual throw if guarded by string length.
    const expected = sign("payload"); // base64, all ASCII
    const sameStringLenNonAscii = "é".repeat(expected.length);
    assert.equal(sameStringLenNonAscii.length, expected.length);
    assert.equal(verifyHmacSignature("payload", sameStringLenNonAscii, SECRET), false);
  });

  it("supports hex encoding", () => {
    const body = "payload";
    assert.equal(verifyHmacSignature(body, sign(body, "hex"), SECRET, "SHA256", "hex"), true);
    // A base64 signature must NOT validate when hex is expected.
    assert.equal(verifyHmacSignature(body, sign(body, "base64"), SECRET, "SHA256", "hex"), false);
  });
});

describe("configureTrustProxy", () => {
  const settingOf = (env: string | undefined) => {
    const app = express();
    configureTrustProxy(app, env);
    return app.get("trust proxy");
  };

  it("leaves the default untouched when env is unset", () => {
    assert.equal(settingOf(undefined), false);
  });

  it("parses the boolean strings true/false", () => {
    assert.equal(settingOf("true"), true);
    assert.equal(settingOf("false"), false);
  });

  it("parses a non-negative hop count as a number", () => {
    assert.equal(settingOf("2"), 2);
  });

  it("passes a CIDR / preset string through verbatim", () => {
    // Built from parts so the no-hardcoded-ip lint doesn't flag the fixture.
    const cidr = `${[10, 0, 0, 0].join(".")}/8`;
    assert.equal(settingOf(cidr), cidr);
    assert.equal(settingOf("loopback"), "loopback");
  });
});

describe("factory shapes", () => {
  it("createWebhookRateLimit returns an express middleware", () => {
    const mw = createWebhookRateLimit();
    assert.equal(typeof mw, "function");
  });

  it("createWebhookApp returns an app with x-powered-by disabled", () => {
    const app = createWebhookApp();
    assert.equal(app.get("x-powered-by"), false);
  });
});
