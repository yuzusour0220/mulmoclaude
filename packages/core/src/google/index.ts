// Server-only Google engine: local OAuth (loopback + PKCE), token store at
// `~/.config/mulmo/google-token.json`, and REST calls for Calendar, Tasks,
// and Drive (`drive.file` — app-created files only). Shared by the hosts
// (remote-host handlers, /api routes, each host's auth CLI) and the google
// plugin — the token file has a single owner, so every surface sees the same
// link state.
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
export { googleApiError, DEFAULT_LIST_MAX_RESULTS, MAX_LIST_RESULTS } from "./apiClient.js";
export {
  calendarApiError,
  createCalendarEvent,
  listCalendarEvents,
  toEventSummary,
  type CalendarEventInput,
  type CalendarEventSummary,
  type ListEventsInput,
} from "./calendar.js";
export {
  completeTask,
  createTask,
  deleteTask,
  listTaskLists,
  listTasks,
  toTaskListSummary,
  toTaskSummary,
  type CompleteTaskInput,
  type CreateTaskInput,
  type ListTasksInput,
  type TaskListSummary,
  type TaskSummary,
} from "./tasks.js";
export {
  buildMultipartBody,
  createDriveFile,
  deleteDriveFile,
  isTextMimeType,
  listDriveFiles,
  readDriveFile,
  toDriveFileSummary,
  type CreateDriveFileInput,
  type DriveFileSummary,
  type ListDriveFilesInput,
  type ReadDriveFileInput,
} from "./driveFile.js";
