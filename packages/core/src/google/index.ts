// Server-only Google engine: local OAuth (loopback + PKCE), token store at
// `~/.config/mulmoclaude/google-token.json`, and Calendar v3 REST calls.
// Shared by the host (remote-host handlers, /api/google routes, the
// `yarn google:auth` CLI) and the google-calendar plugin — the token file has
// a single owner, so every surface sees the same link state.
export { configureGoogleHost, type GoogleLogger } from "./host.js";
export { googleConfigDir, googleSecretsDir, googleTokenPath } from "./paths.js";
export { clientSecretPresence, findClientSecretPath, loadClientSecret, type ClientSecretPresence, type InstalledClientSecret } from "./clientSecret.js";
export { deleteGoogleTokens, loadGoogleTokens, mergeGoogleTokens, saveGoogleTokens } from "./tokenStore.js";
export {
  authorizeGoogle,
  getGoogleAccessToken,
  unlinkGoogle,
  waitForAuthCode,
  GOOGLE_CALENDAR_SCOPE,
  type AuthorizeGoogleOptions,
  type RevokeFetch,
} from "./auth.js";
export { createGoogleAuthFlow, googleAuthFlow, type GoogleAuthFlow, type GoogleAuthFlowStatus } from "./authFlow.js";
export {
  calendarApiError,
  createCalendarEvent,
  listCalendarEvents,
  toEventSummary,
  DEFAULT_LIST_MAX_RESULTS,
  MAX_LIST_RESULTS,
  type CalendarEventInput,
  type CalendarEventSummary,
  type ListEventsInput,
} from "./calendar.js";
