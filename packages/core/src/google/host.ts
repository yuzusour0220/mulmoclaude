// Host binding for the Google engine. The engine logs through the host's
// logger, but a package-level import of the host logger would be an uphill
// dependency — so the host injects it once at startup (same pattern as
// `collection/server/host.ts`). The default is silent so the engine works
// unconfigured in unit tests.

export interface GoogleLogger {
  error: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  warn: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  info: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  debug: (prefix: string, message: string, data?: Record<string, unknown>) => void;
}

const silentLogger: GoogleLogger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

let hostLog: GoogleLogger = silentLogger;

export function configureGoogleHost(binding: { log: GoogleLogger }): void {
  hostLog = binding.log;
}

export const log: GoogleLogger = {
  error: (prefix, message, data) => hostLog.error(prefix, message, data),
  warn: (prefix, message, data) => hostLog.warn(prefix, message, data),
  info: (prefix, message, data) => hostLog.info(prefix, message, data),
  debug: (prefix, message, data) => hostLog.debug(prefix, message, data),
};
