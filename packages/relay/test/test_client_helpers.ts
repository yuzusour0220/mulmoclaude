import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRelayUrl, nextBackoffMs, parseRelayMessage, MAX_BACKOFF_MS } from "../src/client-helpers.js";

describe("buildRelayUrl", () => {
  it("appends the token as a query parameter", () => {
    assert.equal(buildRelayUrl("wss://relay.example.com/ws", "abc123"), "wss://relay.example.com/ws?token=abc123");
  });

  it("appends to a base URL that already has query params", () => {
    assert.equal(buildRelayUrl("wss://relay.example.com/ws?foo=bar", "abc123"), "wss://relay.example.com/ws?foo=bar&token=abc123");
  });

  it("URL-encodes special characters in the token and round-trips", () => {
    const token = "a b/c?d=e&f";
    const result = buildRelayUrl("wss://relay.example.com/ws", token);
    assert.equal(new URL(result).searchParams.get("token"), token);
    assert.ok(!result.includes(token));
  });

  it("preserves the ws:// scheme", () => {
    assert.equal(buildRelayUrl("ws://localhost:8787/ws", "tok"), "ws://localhost:8787/ws?token=tok");
  });

  it("preserves the wss:// scheme", () => {
    assert.equal(buildRelayUrl("wss://localhost:8787/ws", "tok"), "wss://localhost:8787/ws?token=tok");
  });
});

describe("nextBackoffMs", () => {
  it("doubles the value while below the cap", () => {
    assert.equal(nextBackoffMs(1000), 2000);
    assert.equal(nextBackoffMs(2000), 4000);
  });

  it("clamps at MAX_BACKOFF_MS", () => {
    assert.equal(nextBackoffMs(20000), MAX_BACKOFF_MS);
    assert.equal(nextBackoffMs(MAX_BACKOFF_MS), MAX_BACKOFF_MS);
  });

  it("reaches the cap exactly from MAX_BACKOFF_MS / 2", () => {
    assert.equal(nextBackoffMs(MAX_BACKOFF_MS / 2), MAX_BACKOFF_MS);
  });
});

describe("parseRelayMessage", () => {
  it("parses a valid JSON string into an object", () => {
    const message = {
      id: "id-1",
      platform: "line",
      senderId: "user-1",
      chatId: "chat-1",
      text: "hello",
      receivedAt: "2026-07-09T00:00:00.000Z",
    };
    assert.deepEqual(parseRelayMessage(JSON.stringify(message)), message);
  });

  it("returns null for a number", () => {
    assert.equal(parseRelayMessage(42), null);
  });

  it("returns null for an object", () => {
    assert.equal(parseRelayMessage({ id: "id-1" }), null);
  });

  it("returns null for undefined", () => {
    assert.equal(parseRelayMessage(undefined), null);
  });

  it("returns null for null", () => {
    assert.equal(parseRelayMessage(null), null);
  });

  it("returns null for malformed JSON", () => {
    assert.equal(parseRelayMessage("{not json"), null);
  });

  it("returns null for an empty string", () => {
    assert.equal(parseRelayMessage(""), null);
  });
});
