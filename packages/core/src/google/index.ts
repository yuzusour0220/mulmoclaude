// Server-only Google engine: local OAuth (loopback + PKCE), token store at
// `~/.config/mulmo/google-token.json`, and Calendar v3 REST calls.
// Shared by the hosts (remote-host handlers, /api routes, each host's auth
// CLI) and the google plugin — the token file has a single owner, so every
// surface sees the same link state.
export { configureGoogleHost, type GoogleLogger } from "./host.js";
export { isIsoDateTimeWithOffset } from "./datetime.js";
export { googleConfigDir, googleSecretsDir, googleTokenPath, legacyGoogleTokenPath } from "./paths.js";
export { clientSecretPresence, findClientSecretPath, loadClientSecret, type ClientSecretPresence, type InstalledClientSecret } from "./clientSecret.js";
export { deleteGoogleTokens, loadGoogleTokens, mergeGoogleTokens, saveGoogleTokens } from "./tokenStore.js";
export {
  authorizeGoogle,
  getGoogleAccessToken,
  unlinkGoogle,
  waitForAuthCode,
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_TASKS_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_SCOPES,
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
