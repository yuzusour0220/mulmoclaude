// Command-handler table for the remote-host runner.
//
// Phase 1a ships an EMPTY table: the connect → heartbeat presence loop is
// testable without any capability (startHostRunner still heartbeats). Phase 1b
// adds `listCollections` here (see the plan). Keep this the single place the
// runner learns which methods it serves.
import type { CommandHandlers } from "../commandChannel.js";

export const handlers: CommandHandlers = {};
