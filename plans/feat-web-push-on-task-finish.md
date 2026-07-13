# feat: Web Push on task finish (host → registered devices)

## Goal

When an agent turn/task finishes, send a **Web Push** to the user's registered devices
(phone etc.) so they're notified even with the browser closed. Gated by a Settings
on/off toggle. mulmoclaude only *sends* — device registration, PWA, delivery, and
dead-token pruning are the separate `mulmoserver` `sendPush` Cloud Function's job.

## References

- **mulmoserver#46** (CLOSED): PWA + FCM push infrastructure — device registration
  (`users/{uid}/pushRegistrations/{fid}`), Firestore trigger, `sendPush` Cloud Function.
  Already implemented + (per issue) deployed.
- **mulmoterminal#340** (MERGED): the sender-side reference. App only calls `sendPush`.
- **mulmoserver `docs/web-push-sending.md`** — the send contract:
  - `POST https://asia-northeast1-mulmoserver.cloudfunctions.net/sendPush`
  - `Authorization: Bearer <Firebase Auth ID token>`, `Content-Type: application/json`
  - Body `{ "data": { "title", "body" } }` → `{ "result": { sent, failed, targets } }`
  - Target devices resolve from the signed-in uid; caller only needs to be signed in.
  - `targets: 0` ⇒ the user hasn't enabled notifications on any device.

## Decisions

- **Shared package** (`@mulmobridge/web-push`): the send core is auth-agnostic (ID-token
  injected), so both mulmoclaude and mulmoterminal consume one npm package — single source
  of truth for the `sendPush` wire contract. mulmoterminal adoption is a follow-up PR in
  that repo (see below).
- **Server-side send** (not browser-side): works even when the browser tab is closed, as
  long as the machine/server is up — matching the "tell me when I'm away" value.
- **Auth** = the RemoteHost channel's Firebase sign-in (`server/remoteHost/session.ts`,
  project `mulmoserver`, same project as `sendPush`). `auth.currentUser.getIdToken()`.
  ⇒ **push only sends while RemoteHost is connected**; otherwise a silent no-op.
- **Trigger** = every agent turn completion via `finalizeRun` in `server/api/routes/agent.ts`
  (fires once per finished run). Skips hidden/system utility sessions (translation workers,
  hidden background helpers) — those aren't real user tasks.
- **Toggle** = new `pushEnabled?: boolean` on `AppSettings` (workspace `settings.json`),
  read live at the trigger so a settings change takes effect without a restart. Mirrors the
  existing `voiceInput.enabled` boolean-setting plumbing.

## Architecture

### New leaf package `@mulmobridge/web-push` (`packages/web-push/`)

No firebase / no app dependency — pure + `fetch`, auth injected.

```ts
export interface SendPushResult { sent: number; failed: number; targets: number }
export interface SendWebPushOptions {
  getIdToken: () => Promise<string | null>; // null → not signed in → no-op
  url?: string;            // default DEFAULT_SEND_PUSH_URL (mulmoserver)
  timeoutMs?: number;      // default 8000
  fetchImpl?: typeof fetch; // default globalThis.fetch (test seam)
}
export const DEFAULT_SEND_PUSH_URL: string;
export function buildSendPushBody(title: string, body: string): string;      // {data:{title,body}}
export function parseSendPushResult(json: unknown): SendPushResult | null;    // {sent,failed,targets}|null
export async function sendWebPush(title: string, body: string, opts: SendWebPushOptions): Promise<SendPushResult | null>;
```

`sendWebPush`: no-op (returns null, never fetches) when `getIdToken()` returns null;
`AbortController` timeout; never throws (a failed push must not disturb the trigger).

### mulmoclaude wiring (host repo)

- `server/remoteHost/session.ts` — add `currentIdToken(): Promise<string | null>`
  (`handles?.auth.currentUser` → `getIdToken()`, else null).
- `server/agent/webPush.ts` (new) — `notifyTaskFinished(chatSessionId)`: build title/body,
  call `sendWebPush(..., { getIdToken: currentIdToken })`. Fire-and-forget.
  - title = session title / working dir basename; body = last user prompt
    (fallback `"タスクが完了しました"`). Length-capped.
- `server/api/routes/agent.ts` — in `finalizeRun`, after cleanup, call
  `notifyTaskFinished(chatSessionId)` when push is enabled and the session isn't hidden.
- `server/system/config.ts` — `pushEnabled?: boolean` on `AppSettings` + validators
  (`isAppSettings`, `isAppSettingsPatch`, `normaliseAppSettingsPatch`).
- Client Settings modal — a "Web Push 通知" toggle → `PUT /api/config/settings { pushEnabled }`,
  with a note it needs RemoteHost connected + a registered device.
- `packages/mulmoclaude/package.json` — add `@mulmobridge/web-push` dep (launcher bundle).
- README / `docs/remote-host.md` — document the toggle + prerequisite.

## Testing

- **Package** (`packages/web-push/test/`): `buildSendPushBody`, `parseSendPushResult`
  (valid / missing-counts / non-envelope), `sendWebPush` no-op when `getIdToken` → null
  (never fetches), success path via injected `fetchImpl`, timeout/abort → null.
- **mulmoclaude**: `currentIdToken` null when disconnected; `notifyTaskFinished` no-op when
  `pushEnabled` off / session hidden; `AppSettings` round-trip with `pushEnabled`.
- Gates: format / lint / typecheck / build / test.
- **Manual (user)**: real delivery needs a Google sign-in (RemoteHost connected) + a
  registered device — verify a push arrives after connecting RemoteHost + enabling the toggle.

## Cross-repo follow-up (separate)

- Publish `@mulmobridge/web-push@0.1.0` to npm (via `/publish`).
- **mulmoterminal**: follow-up PR replacing `server/web-push.ts` internals with
  `@mulmobridge/web-push`, injecting its own `getIdToken`. Keeps its own toggle/trigger.

## User manual steps (one-time, already covered by mulmoserver#46)

1. VAPID key pair in Firebase Console (mulmoserver) — done as part of #46.
2. On the phone: add the PWA to home screen (iOS) + grant notification permission.
3. `sendPush` Cloud Function deployed.

## Possible follow-ups

- Suppress the push when the browser is actively focused on that session (needs a focus
  signal) — avoid notifying when the user is right there.
- Per-session / per-role push opt-out.
- Browser-side fallback send when RemoteHost isn't connected.
- Use the AI turn summary as the body instead of the last prompt.
