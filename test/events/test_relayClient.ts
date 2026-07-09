import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ChatService } from "@mulmobridge/chat-service";
import { createResponseQueue, handleRelayMessage } from "../../server/events/relay-client.js";

type RelayFn = ChatService["relay"];
type RelayParams = Parameters<RelayFn>[0];

// Structural mirror of the module-private RelayResponse — lets the
// tests capture/assert responses without widening the public surface.
interface RelayResponseLike {
  platform: string;
  chatId: string;
  text: string;
  replyToken?: string;
}

// Mirror of MAX_RESPONSE_QUEUE in relay-client.ts (kept private there).
const QUEUE_CAP = 100;

interface LogCall {
  level: "info" | "warn" | "error";
  prefix: string;
  msg: string;
  data?: Record<string, unknown>;
}

function createFakeLogger() {
  const calls: LogCall[] = [];
  const record =
    (level: LogCall["level"]) =>
    (prefix: string, msg: string, data?: Record<string, unknown>): void => {
      calls.push({ level, prefix, msg, data });
    };
  const logger = { info: record("info"), warn: record("warn"), error: record("error") };
  const findByMsg = (msg: string): LogCall | undefined => calls.find((call) => call.msg === msg);
  const countByMsg = (msg: string): number => calls.filter((call) => call.msg === msg).length;
  return { logger, calls, findByMsg, countByMsg };
}

const validMessage = {
  id: "msg-1",
  platform: "line",
  senderId: "u-1",
  chatId: "c-1",
  text: "hello",
  receivedAt: "2026-07-09T00:00:00Z",
  replyToken: "tok-1",
};

const capture = () => {
  const responses: RelayResponseLike[] = [];
  const sendResponse = (res: RelayResponseLike): void => {
    responses.push(res);
  };
  return { responses, sendResponse };
};

describe("handleRelayMessage", () => {
  it("invalid JSON → warns and calls neither relay nor sendResponse", async () => {
    const { logger, findByMsg } = createFakeLogger();
    let relayCalls = 0;
    const relay: RelayFn = async () => {
      relayCalls += 1;
      return { kind: "ok", reply: "x" };
    };
    const { responses, sendResponse } = capture();

    await handleRelayMessage("{ not json", { relay, logger, sendResponse });

    assert.equal(relayCalls, 0);
    assert.equal(responses.length, 0);
    const warn = findByMsg("invalid JSON from relay");
    assert.equal(warn?.level, "warn");
    assert.equal(warn?.data?.length, "{ not json".length);
  });

  it("malformed message → warns and calls neither relay nor sendResponse", async () => {
    const { logger, findByMsg } = createFakeLogger();
    let relayCalls = 0;
    const relay: RelayFn = async () => {
      relayCalls += 1;
      return { kind: "ok", reply: "x" };
    };
    const { responses, sendResponse } = capture();

    // Valid JSON but missing required `text` / `chatId`.
    await handleRelayMessage(JSON.stringify({ id: "x", platform: "line" }), { relay, logger, sendResponse });

    assert.equal(relayCalls, 0);
    assert.equal(responses.length, 0);
    assert.equal(findByMsg("malformed relay message")?.level, "warn");
  });

  it("happy path → forwards to relay and sends the formatted reply", async () => {
    const { logger } = createFakeLogger();
    const captured: RelayParams[] = [];
    const relay: RelayFn = async (params) => {
      captured.push(params);
      return { kind: "ok", reply: "pong" };
    };
    const { responses, sendResponse } = capture();

    await handleRelayMessage(JSON.stringify(validMessage), { relay, logger, sendResponse });

    assert.equal(captured.length, 1);
    assert.equal(captured[0].transportId, "relay");
    assert.equal(captured[0].externalChatId, "line__c-1");
    assert.equal(captured[0].text, "hello");
    assert.equal(typeof captured[0].bridgeOptions, "object");
    assert.notEqual(captured[0].bridgeOptions, null);

    assert.deepEqual(responses, [{ platform: "line", chatId: "c-1", text: "pong", replyToken: "tok-1" }]);
  });

  it("error-kind result → sends the 'Error: <message>' reply", async () => {
    const { logger } = createFakeLogger();
    const relay: RelayFn = async () => ({ kind: "error", status: 500, message: "nope" });
    const { responses, sendResponse } = capture();

    await handleRelayMessage(JSON.stringify(validMessage), { relay, logger, sendResponse });

    assert.equal(responses.length, 1);
    assert.equal(responses[0].text, "Error: nope");
    assert.equal(responses[0].replyToken, "tok-1");
  });

  it("relay throws → sends the fallback error reply and logs the failure", async () => {
    const { logger, findByMsg } = createFakeLogger();
    const relay: RelayFn = async () => {
      throw new Error("boom");
    };
    const { responses, sendResponse } = capture();

    await handleRelayMessage(JSON.stringify(validMessage), { relay, logger, sendResponse });

    assert.deepEqual(responses, [{ platform: "line", chatId: "c-1", text: "Error: failed to process message", replyToken: "tok-1" }]);
    const err = findByMsg("relay processing failed");
    assert.equal(err?.level, "error");
    assert.equal(err?.data?.id, "msg-1");
    assert.match(String(err?.data?.error), /boom/);
  });

  it("preserves an absent replyToken", async () => {
    const { logger } = createFakeLogger();
    const relay: RelayFn = async () => ({ kind: "ok", reply: "pong" });
    const { responses, sendResponse } = capture();
    const noToken = { ...validMessage };
    delete (noToken as { replyToken?: string }).replyToken;

    await handleRelayMessage(JSON.stringify(noToken), { relay, logger, sendResponse });

    assert.equal(responses.length, 1);
    assert.equal(responses[0].replyToken, undefined);
  });
});

const makeResponse = (num: number): RelayResponseLike => ({ platform: "line", chatId: `c-${num}`, text: `t-${num}` });

// A trySend stub whose result is scripted per call. Records every
// response it was handed, in order.
function scriptedTrySend(results: boolean[]) {
  const seen: RelayResponseLike[] = [];
  let idx = 0;
  const trySend = (response: RelayResponseLike): boolean => {
    seen.push(response);
    const result = idx < results.length ? results[idx] : false;
    idx += 1;
    return result;
  };
  return { trySend, seen };
}

// A trySend that always accepts and records what it drained.
function drainingTrySend() {
  const delivered: RelayResponseLike[] = [];
  const trySend = (response: RelayResponseLike): boolean => {
    delivered.push(response);
    return true;
  };
  return { trySend, delivered };
}

// A trySend whose transport can be opened/closed at runtime: while
// closed it rejects (returns false) like a disconnected socket; while
// open it accepts and records. Models the flush-after-reconnect path.
function gatedTrySend() {
  const gate = { open: false };
  const delivered: RelayResponseLike[] = [];
  const trySend = (response: RelayResponseLike): boolean => {
    if (!gate.open) return false;
    delivered.push(response);
    return true;
  };
  return { trySend, delivered, gate };
}

describe("createResponseQueue", () => {
  it("send delivers straight through when trySend returns true", () => {
    const { logger, calls } = createFakeLogger();
    const { trySend, delivered } = drainingTrySend();
    const queue = createResponseQueue({ logger, trySend });

    queue.send(makeResponse(1));

    assert.deepEqual(delivered, [makeResponse(1)]);
    assert.equal(calls.length, 0);

    // Nothing was queued, so a subsequent flush drains nothing (trySend
    // is not called again; `delivered` is unchanged).
    queue.flush();
    assert.deepEqual(delivered, [makeResponse(1)]);
  });

  it("send queues and logs the queueSize when trySend returns false", () => {
    const { logger, findByMsg } = createFakeLogger();
    const rejecting = scriptedTrySend([false]);
    const queue = createResponseQueue({ logger, trySend: rejecting.trySend });

    queue.send(makeResponse(1));

    assert.deepEqual(rejecting.seen, [makeResponse(1)]);
    const log = findByMsg("response queued (not connected)");
    assert.equal(log?.level, "error");
    assert.equal(log?.data?.queueSize, 1);
    assert.equal(log?.data?.chatId, "c-1");
  });

  it("send then flush drains the queued item once the transport accepts", () => {
    const { logger } = createFakeLogger();
    const { trySend, delivered, gate } = gatedTrySend();
    const queue = createResponseQueue({ logger, trySend });

    queue.send(makeResponse(1));
    assert.equal(delivered.length, 0);

    gate.open = true;
    queue.flush();
    assert.deepEqual(delivered, [makeResponse(1)]);
  });

  it("enqueue drops the oldest response at the cap", () => {
    const { logger, findByMsg, countByMsg } = createFakeLogger();
    const { trySend, delivered } = drainingTrySend();
    const queue = createResponseQueue({ logger, trySend });

    for (let num = 1; num <= QUEUE_CAP; num += 1) queue.enqueue(makeResponse(num));
    // The (cap + 1)-th enqueue evicts the oldest (c-1) before pushing.
    queue.enqueue(makeResponse(QUEUE_CAP + 1));

    assert.equal(countByMsg("response queue full, dropping oldest"), 1);
    assert.equal(findByMsg("response queue full, dropping oldest")?.data?.chatId, `c-${QUEUE_CAP + 1}`);

    queue.flush();
    assert.equal(delivered.length, QUEUE_CAP);
    assert.equal(delivered[0].chatId, "c-2");
    assert.equal(delivered[QUEUE_CAP - 1].chatId, `c-${QUEUE_CAP + 1}`);
    assert.ok(!delivered.some((res) => res.chatId === "c-1"));
  });

  it("flush stops at the first failed trySend and does not try later items", () => {
    const { logger } = createFakeLogger();
    // Accept c-1, reject c-2 (and would-be c-3).
    const first = scriptedTrySend([true, false, false]);
    const queue = createResponseQueue({ logger, trySend: first.trySend });

    queue.enqueue(makeResponse(1));
    queue.enqueue(makeResponse(2));
    queue.enqueue(makeResponse(3));

    queue.flush();
    // Tried c-1 (ok, shifted) then c-2 (rejected → break). c-3 never tried.
    assert.deepEqual(
      first.seen.map((res) => res.chatId),
      ["c-1", "c-2"],
    );
    // Retention + FIFO order of the unsent tail is covered by the
    // "flush preserves order" test below (needs a re-openable transport).
  });

  it("flush preserves order of unsent items across successive flushes", () => {
    const { logger } = createFakeLogger();
    const { trySend, delivered, gate } = gatedTrySend();
    const queue = createResponseQueue({ logger, trySend });

    queue.enqueue(makeResponse(1));
    queue.enqueue(makeResponse(2));
    queue.enqueue(makeResponse(3));

    // Transport closed: flush sends nothing, loses nothing.
    queue.flush();
    assert.equal(delivered.length, 0);

    // Transport open: flush drains everything in FIFO order.
    gate.open = true;
    queue.flush();
    assert.deepEqual(
      delivered.map((res) => res.chatId),
      ["c-1", "c-2", "c-3"],
    );
  });

  it("flush on an empty queue does nothing", () => {
    const { logger, calls } = createFakeLogger();
    let tryCalls = 0;
    const trySend = (): boolean => {
      tryCalls += 1;
      return true;
    };
    const queue = createResponseQueue({ logger, trySend });

    queue.flush();

    assert.equal(tryCalls, 0);
    assert.equal(calls.length, 0);
  });

  it("send-failure requeue path: enqueue re-adds a response that trySend later drains", () => {
    // Mirrors what connectRelay's trySend does on an async send error:
    // it calls queue.enqueue(response). Verify the item is retained and
    // drains in order on the next flush.
    const { logger } = createFakeLogger();
    const { trySend, delivered, gate } = gatedTrySend();
    const queue = createResponseQueue({ logger, trySend });

    queue.enqueue(makeResponse(1)); // simulated requeue after send failure
    gate.open = true;
    queue.flush();

    assert.deepEqual(delivered, [makeResponse(1)]);
  });
});
