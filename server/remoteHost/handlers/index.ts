// Command-handler table for the remote-host runner — the single place the
// runner learns which methods it serves. Add a capability by importing its
// handler and adding it here.
import type { CommandHandlers } from "../commandChannel.js";
import { listCollections } from "./listCollections.js";

export const handlers: CommandHandlers = { listCollections };
