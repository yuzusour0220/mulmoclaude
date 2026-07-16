// Zod arg schemas for the `google` tool, in their own module so the
// dispatch (index.ts) and the tests can share them without pulling in
// the definePlugin factory body.
import { z } from "zod";
import { isIsoDateTimeWithOffset, MAX_LIST_RESULTS } from "@mulmoclaude/core/google";

// Calendar rejects date-only / offset-less / impossible values on `dateTime`
// with an opaque 400, so the strict shared validator runs here where the LLM
// gets an actionable message.
const IsoDateTimeWithOffset = z.string().refine(isIsoDateTimeWithOffset, {
  error: "must be an ISO 8601 date-time with a timezone offset (e.g. 2026-07-17T09:00:00+09:00)",
});

export const GoogleArgs = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status") }),
  z.object({
    kind: z.literal("calendarListEvents"),
    timeMin: IsoDateTimeWithOffset.optional(),
    maxResults: z.number().int().min(1).max(MAX_LIST_RESULTS).optional(),
  }),
  z.object({
    kind: z.literal("calendarCreateEvent"),
    summary: z.string().min(1),
    start: IsoDateTimeWithOffset,
    end: IsoDateTimeWithOffset,
    description: z.string().optional(),
  }),
]);
export type GoogleArgs = z.infer<typeof GoogleArgs>;
