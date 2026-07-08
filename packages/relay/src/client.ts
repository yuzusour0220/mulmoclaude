// Relay WebSocket client for MulmoClaude.
//
// Connects to the relay server, receives messages from all
// platforms, and sends responses back. Auto-reconnects on
// disconnect with exponential backoff.
//
// The bearer token is sent as a query parameter (?token=...)
// because the browser WebSocket API does not support custom
// Authorization headers.

import type { RelayMessage, RelayResponse } from "./types.js";
import { buildRelayUrl, nextBackoffMs, parseRelayMessage, INITIAL_BACKOFF_MS } from "./client-helpers.js";

export interface RelayClientOptions {
  url: string;
  token: string;
  onMessage: (msg: RelayMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (err: Error) => void;
}

export interface RelayClient {
  connect: () => void;
  send: (response: RelayResponse) => void;
  disconnect: () => void;
  readonly connected: boolean;
}

export function createRelayClient(opts: RelayClientOptions): RelayClient {
  let webSocket: WebSocket | null = null;
  let backoffMs = INITIAL_BACKOFF_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let intentionalClose = false;

  function buildUrl(): string {
    return buildRelayUrl(opts.url, opts.token);
  }

  function connect(): void {
    intentionalClose = false;
    try {
      webSocket = new WebSocket(buildUrl());

      webSocket.onopen = () => {
        backoffMs = INITIAL_BACKOFF_MS;
        opts.onConnect?.();
      };

      webSocket.onmessage = (event: MessageEvent) => {
        const msg = parseRelayMessage(event.data);
        if (msg !== null) opts.onMessage(msg);
      };

      webSocket.onclose = () => {
        webSocket = null;
        opts.onDisconnect?.();
        if (!intentionalClose) scheduleReconnect();
      };

      webSocket.onerror = () => {
        opts.onError?.(new Error("WebSocket error"));
      };
    } catch (err) {
      opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      scheduleReconnect();
    }
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      backoffMs = nextBackoffMs(backoffMs);
      connect();
    }, backoffMs);
  }

  function send(response: RelayResponse): void {
    if (!webSocket || webSocket.readyState !== WebSocket.OPEN) {
      opts.onError?.(new Error("not connected"));
      return;
    }
    webSocket.send(JSON.stringify(response));
  }

  function disconnect(): void {
    intentionalClose = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (webSocket) {
      webSocket.close(1000, "client disconnect");
      webSocket = null;
    }
  }

  return {
    connect,
    send,
    disconnect,
    get connected() {
      return webSocket !== null && webSocket.readyState === WebSocket.OPEN;
    },
  };
}
