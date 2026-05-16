// Encore plugin — server-side handler module.
//
// Skeleton (Step 1 of plans/feat-encore-as-builtin.md). All handlers
// currently return "not implemented" stubs; Steps 2–5 fill them in:
//
//   Step 2: DSL + paths + io (the validator + on-disk shape)
//   Step 3: setup / amendDefinition / query / appendNote
//   Step 4: tick + markStepDone / markTargetSkipped / recordValues / snooze
//   Step 5: resolveNotification (click-handler page)
//
// The Express route handler in `server/api/routes/encore.ts` calls
// `dispatch(body)` here; in turn, `dispatch` switches on `body.kind`
// and forwards to the per-kind handler. Errors thrown here surface as
// 400/500 in the route handler.

export interface EncoreDispatchBody {
  kind: string;
  [key: string]: unknown;
}

export interface EncoreDispatchResult {
  ok: boolean;
  message: string;
  [key: string]: unknown;
}

export class EncoreError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "EncoreError";
  }
}

async function handleNotImplemented(kind: string): Promise<EncoreDispatchResult> {
  return {
    ok: false,
    message: `Encore ${JSON.stringify(kind)} is not implemented yet — built-in plugin skeleton landed Step 1 of plans/feat-encore-as-builtin.md.`,
  };
}

export async function dispatch(body: EncoreDispatchBody): Promise<EncoreDispatchResult> {
  if (!body || typeof body !== "object") {
    throw new EncoreError(400, "request body must be an object with a string `kind` field");
  }
  const { kind } = body;
  if (typeof kind !== "string") {
    throw new EncoreError(400, "missing or non-string `kind`");
  }
  switch (kind) {
    case "setup":
    case "amendDefinition":
    case "markStepDone":
    case "markTargetSkipped":
    case "recordValues":
    case "query":
    case "appendNote":
    case "snooze":
    case "resolveNotification":
      return handleNotImplemented(kind);
    default:
      throw new EncoreError(400, `unknown kind ${JSON.stringify(kind)}`);
  }
}
