// Unit tests for the settings-UI OAuth flow manager: single-flight,
// URL reuse while pending, completion/failure state. authorizeGoogle is
// stubbed — no network, no browser.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { authorizeGoogle } from "../../../server/services/google/auth.js";
import { createGoogleAuthFlow } from "../../../server/services/google/authFlow.js";

const settleMicrotasks = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const makeAuthorizeStub = () => {
  const settlers: { complete: () => void; fail: (err: Error) => void }[] = [];
  let calls = 0;
  const authorize: typeof authorizeGoogle = async (opts = {}) => {
    calls += 1;
    const call = calls;
    return new Promise((resolve, reject) => {
      settlers.push({ complete: () => resolve({ refresh_token: "stub" }), fail: reject });
      opts.onAuthUrl?.(`https://accounts.google.com/consent?call=${call}`);
    });
  };
  return {
    authorize,
    callCount: () => calls,
    complete: (index: number) => settlers[index]?.complete(),
    fail: (index: number, err: Error) => settlers[index]?.fail(err),
  };
};

describe("createGoogleAuthFlow", () => {
  it("returns the consent URL and reports pending", async () => {
    const stub = makeAuthorizeStub();
    const flow = createGoogleAuthFlow(stub.authorize);
    const { authUrl } = await flow.start();
    assert.match(authUrl, /call=1/);
    assert.deepEqual(flow.status(), { pending: true, lastError: null });
  });

  it("reuses the pending flow instead of starting a second one", async () => {
    const stub = makeAuthorizeStub();
    const flow = createGoogleAuthFlow(stub.authorize);
    const first = await flow.start();
    const second = await flow.start();
    assert.equal(second.authUrl, first.authUrl);
    assert.equal(stub.callCount(), 1);
  });

  it("shares one flow across concurrent start() calls even when the URL arrives asynchronously", async () => {
    let calls = 0;
    const authorize: typeof authorizeGoogle = async (opts = {}) => {
      calls += 1;
      return new Promise(() => {
        setImmediate(() => opts.onAuthUrl?.("https://accounts.google.com/consent?async=1"));
      });
    };
    const flow = createGoogleAuthFlow(authorize);
    const [first, second] = await Promise.all([flow.start(), flow.start()]);
    assert.equal(first.authUrl, second.authUrl);
    assert.equal(calls, 1);
  });

  it("clears pending on completion and allows a fresh flow", async () => {
    const stub = makeAuthorizeStub();
    const flow = createGoogleAuthFlow(stub.authorize);
    await flow.start();
    stub.complete(0);
    await settleMicrotasks();
    assert.deepEqual(flow.status(), { pending: false, lastError: null });
    const next = await flow.start();
    assert.match(next.authUrl, /call=2/);
    assert.equal(stub.callCount(), 2);
  });

  it("records the error when the flow fails after the URL was issued", async () => {
    const stub = makeAuthorizeStub();
    const flow = createGoogleAuthFlow(stub.authorize);
    await flow.start();
    stub.fail(0, new Error("consent denied"));
    await settleMicrotasks();
    assert.deepEqual(flow.status(), { pending: false, lastError: "consent denied" });
  });

  it("clears a previous error when a new flow starts", async () => {
    const stub = makeAuthorizeStub();
    const flow = createGoogleAuthFlow(stub.authorize);
    await flow.start();
    stub.fail(0, new Error("consent denied"));
    await settleMicrotasks();
    await flow.start();
    assert.deepEqual(flow.status(), { pending: true, lastError: null });
  });

  it("rejects start() when authorize fails before issuing a URL", async () => {
    const authorize: typeof authorizeGoogle = async () => {
      throw new Error("no client secret");
    };
    const flow = createGoogleAuthFlow(authorize);
    await assert.rejects(flow.start(), /no client secret/);
    await settleMicrotasks();
    assert.deepEqual(flow.status(), { pending: false, lastError: "no client secret" });
  });
});
