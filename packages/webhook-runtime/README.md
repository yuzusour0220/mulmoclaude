# @mulmobridge/webhook-runtime

Shared HTTP-webhook plumbing for the MulmoClaude messaging bridges that
receive events over an inbound webhook (LINE, WhatsApp, Viber, LINE WORKS,
Messenger, Google Chat).

- `createWebhookApp({ bodyLimit? })` — Express app with `x-powered-by`
  disabled, `BRIDGE_TRUST_PROXY` honoured, and raw-text body parsing so the
  HMAC signature can be verified before JSON parsing.
- `configureTrustProxy(app, env?)` — parse `BRIDGE_TRUST_PROXY`
  (boolean / hop-count / preset / CIDR) and apply it.
- `createWebhookRateLimit(limitPerMinute?)` — IPv6-safe per-IP rate limit.
- `verifyHmacSignature(body, signature, secret, algorithm?, encoding?)` —
  length-guarded, timing-safe HMAC comparison.

These are security-relevant and hardened through Codex reviews (#1326);
keeping one copy means a fix lands once, not once per bridge.
