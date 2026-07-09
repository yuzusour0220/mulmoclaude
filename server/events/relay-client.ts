// MulmoBridge Relay WebSocket client.
//
// Connects to the Relay (Cloudflare Workers) and forwards incoming
// platform messages to the chat-service relay function. Handles
// reconnection with exponential backoff. Uses the `ws` npm package,
// so it is Node-only — there is no longer a browser/edge counterpart.

import WebSocket from "ws";
import type { ChatService } from "@mulmobridge/chat-service";
import { ONE_SECOND_MS } from "../utils/time.js";
import { errorMessage } from "../utils/errors.js";
import { resolveRelayBridgeOptions } from "./resolveRelayBridgeOptions.js";
import {
  buildExternalChatId,
  buildRelayUrl,
  formatReplyText,
  isRelayMessage,
  isTerminalCloseCode,
  nextReconnectMs,
  type RelayMessage,
} from "./relay-client-helpers.js";

type RelayFn = ChatService["relay"];

// ── Types ────────────────────────────────────────────────────

interface RelayResponse {
  platform: string;
  chatId: string;
  text: string;
  replyToken?: string;
}

interface Logger {
  info: (prefix: string, msg: string, data?: Record<string, unknown>) => void;
  warn: (prefix: string, msg: string, data?: Record<string, unknown>) => void;
  error: (prefix: string, msg: string, data?: Record<string, unknown>) => void;
}

export interface RelayClientDeps {
  relayUrl: string;
  relayToken: string;
  relay: RelayFn;
  logger: Logger;
}

export interface RelayClientHandle {
  disconnect: () => void;
}

// ── Constants ────────────────────────────────────────────────

const LOG_PREFIX = "relay-client";
const TRANSPORT_ID = "relay";
const MIN_RECONNECT_MS = ONE_SECOND_MS;
const MAX_RECONNECT_MS = 30 * ONE_SECOND_MS;
const MAX_RESPONSE_QUEUE = 100;

// ── Incoming message handling ────────────────────────────────

interface HandleRelayMessageDeps {
  relay: RelayFn;
  logger: Logger;
  sendResponse: (response: RelayResponse) => void;
}

function replyTo(msg: RelayMessage, text: string, sendResponse: (response: RelayResponse) => void): void {
  sendResponse({
    platform: msg.platform,
    chatId: msg.chatId,
    text,
    replyToken: msg.replyToken,
  });
}

// Parse one raw relay frame, forward it to the chat-service relay
// function, and ship the reply back. Closes over no socket / timer /
// mutable state, so it is unit-testable in isolation.
export async function handleRelayMessage(raw: string, deps: HandleRelayMessageDeps): Promise<void> {
  const { relay, logger, sendResponse } = deps;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn(LOG_PREFIX, "invalid JSON from relay", {
      length: raw.length,
    });
    return;
  }

  if (!isRelayMessage(parsed)) {
    logger.warn(LOG_PREFIX, "malformed relay message");
    return;
  }
  const msg = parsed;

  logger.info(LOG_PREFIX, "message received", {
    id: msg.id,
    platform: msg.platform,
    chatId: msg.chatId,
    textLength: msg.text.length,
  });

  const externalChatId = buildExternalChatId(msg.platform, msg.chatId);

  try {
    // Per-platform default-role resolution (#739). Mirrors the
    // bridges-side handshake (#729): each platform can pin its own
    // default role via `RELAY_<PLATFORM>_DEFAULT_ROLE`, with
    // `RELAY_DEFAULT_ROLE` as the blanket fallback. The helper
    // never forwards `RELAY_TOKEN` / `RELAY_URL` — they aren't on
    // the recognised-keys allowlist.
    const bridgeOptions = resolveRelayBridgeOptions(msg.platform, process.env);
    const result = await relay({
      transportId: TRANSPORT_ID,
      externalChatId,
      text: msg.text,
      bridgeOptions,
    });

    replyTo(msg, formatReplyText(result), sendResponse);
  } catch (err) {
    logger.error(LOG_PREFIX, "relay processing failed", {
      id: msg.id,
      error: errorMessage(err),
    });
    replyTo(msg, "Error: failed to process message", sendResponse);
  }
}

// ── Response queue ───────────────────────────────────────────

interface ResponseQueue {
  enqueue: (response: RelayResponse) => void;
  send: (response: RelayResponse) => void;
  flush: () => void;
}

interface ResponseQueueDeps {
  logger: Logger;
  trySend: (response: RelayResponse) => boolean;
}

// A bounded FIFO of outgoing responses that owns its own buffer. The
// live socket stays in the parent; `trySend` is injected as the
// transport strategy (it returns false when the socket is missing /
// not OPEN), so the queue never touches the socket directly.
export function createResponseQueue(deps: ResponseQueueDeps): ResponseQueue {
  const { logger, trySend } = deps;
  const responseQueue: RelayResponse[] = [];

  function enqueue(response: RelayResponse): void {
    if (responseQueue.length >= MAX_RESPONSE_QUEUE) {
      logger.error(LOG_PREFIX, "response queue full, dropping oldest", {
        platform: response.platform,
        chatId: response.chatId,
      });
      responseQueue.shift();
    }
    responseQueue.push(response);
  }

  function send(response: RelayResponse): void {
    if (trySend(response)) return;
    enqueue(response);
    logger.error(LOG_PREFIX, "response queued (not connected)", {
      platform: response.platform,
      chatId: response.chatId,
      queueSize: responseQueue.length,
    });
  }

  function flush(): void {
    if (responseQueue.length === 0) return;
    logger.info(LOG_PREFIX, "flushing response queue", {
      count: responseQueue.length,
    });
    // `trySend` returns false when the socket isn't OPEN, so it alone
    // gates the drain — stop at the first response we can't send and
    // leave it (plus the rest) queued for the next flush.
    while (responseQueue.length > 0) {
      const [response] = responseQueue;
      if (!trySend(response)) break;
      responseQueue.shift();
    }
  }

  return { enqueue, send, flush };
}

// ── Factory ─────────────────────────────────────────────────

export function connectRelay(deps: RelayClientDeps): RelayClientHandle {
  const { relayUrl, relayToken, relay, logger } = deps;

  let socket: WebSocket | null = null;
  let reconnectMs = MIN_RECONNECT_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const queue = createResponseQueue({ logger, trySend });

  function connect(): void {
    if (stopped) return;

    try {
      socket = new WebSocket(buildRelayUrl(relayUrl, relayToken));
    } catch (err) {
      logger.error(LOG_PREFIX, "failed to create WebSocket", {
        error: errorMessage(err),
      });
      scheduleReconnect();
      return;
    }

    socket.on("open", () => {
      logger.info(LOG_PREFIX, "connected", { url: relayUrl });
      reconnectMs = MIN_RECONNECT_MS;
      queue.flush();
    });

    socket.on("message", (data) => {
      handleRelayMessage(String(data), { relay, logger, sendResponse: queue.send });
    });

    socket.on("close", (code, reason) => {
      socket = null;
      if (isTerminalCloseCode(code)) {
        logger.error(LOG_PREFIX, "terminal close, not reconnecting", {
          code,
          reason: String(reason),
        });
        return;
      }
      logger.info(LOG_PREFIX, "disconnected", {
        code,
        reason: String(reason),
      });
      scheduleReconnect();
    });

    socket.on("error", (err) => {
      logger.warn(LOG_PREFIX, "connection error", {
        error: err.message,
      });
      // close event will follow, triggering reconnect
    });
  }

  function scheduleReconnect(): void {
    if (stopped) return;
    logger.info(LOG_PREFIX, "reconnecting", { delayMs: reconnectMs });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectMs);
    reconnectMs = nextReconnectMs(reconnectMs, MAX_RECONNECT_MS);
  }

  function trySend(response: RelayResponse): boolean {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(response), (err) => {
        if (err && !stopped) {
          logger.warn(LOG_PREFIX, "send failed, requeueing", {
            platform: response.platform,
            chatId: response.chatId,
            error: err.message,
          });
          queue.enqueue(response);
        }
      });
      return true;
    } catch {
      return false;
    }
  }

  function disconnect(): void {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket) {
      socket.close(1000, "shutdown");
      socket = null;
    }
    logger.info(LOG_PREFIX, "stopped");
  }

  // Start immediately
  connect();

  return { disconnect };
}
