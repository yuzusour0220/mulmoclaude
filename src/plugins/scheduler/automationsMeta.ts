import { definePluginMeta } from "../meta-types";

// Automations owns the shared `/api/scheduler` namespace. The route
// block + `mcpDispatch` were relocated here from the (deleted)
// calendar META when the Calendar view + `manageCalendar` tool were
// removed — automations is now the sole declarer. The server still
// splits task actions from any legacy calendar-item actions via the
// `action` discriminator (see `TASK_ACTIONS`).
export const META = definePluginMeta({
  toolName: "manageAutomations",
  apiNamespace: "scheduler",
  apiRoutes: {
    /** GET /api/scheduler — read scheduler (legacy calendar) items. */
    list: { method: "GET", path: "" },
    /** POST /api/scheduler — scheduler action dispatch. */
    dispatch: { method: "POST", path: "" },
    /** GET /api/scheduler/tasks — list every registered task
     *  (system + user). */
    tasksList: { method: "GET", path: "/tasks" },
    /** POST /api/scheduler/tasks — create a user task. */
    tasksCreate: { method: "POST", path: "/tasks" },
    /** PUT /api/scheduler/tasks/:id — update a user task. */
    taskUpdate: { method: "PUT", path: "/tasks/:id" },
    /** DELETE /api/scheduler/tasks/:id — delete a user task. */
    taskDelete: { method: "DELETE", path: "/tasks/:id" },
    /** POST /api/scheduler/tasks/:id/run — fire a task immediately. */
    taskRun: { method: "POST", path: "/tasks/:id/run" },
    /** GET /api/scheduler/logs — newest-first scheduler execution log. */
    logs: { method: "GET", path: "/logs" },
  },
  mcpDispatch: "dispatch",
});
