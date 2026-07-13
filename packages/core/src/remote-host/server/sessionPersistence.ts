// A custom Firebase Auth persistence that keeps the signed-in session in memory
// but can be seeded from — and exported back to — an opaque blob, so a host's
// Firebase session survives a process restart by being parked in the browser's
// localStorage (mulmoserver#50, "case A'"). The blob is whatever the SDK wrote
// into persistence, round-tripped through JSON; we NEVER interpret its fields,
// so we don't couple to the SDK's serialized-user format across versions.
//
// `type: "LOCAL"` makes the SDK treat this as durable and persist the user (as
// it would with localStorage/IndexedDB). Seed BEFORE `initializeAuth` — the SDK
// reads persistence once at init. `onChange` fires when the SDK writes or
// removes a key (a token update that rotates the stored blob, or a sign-out),
// which is the signal to re-sync the browser copy.
import type { Persistence } from "firebase/auth";

// The SDK stores values as JSON objects (a serialized user) or strings. We treat
// them opaquely — a value is either.
type PersistenceValue = Record<string, unknown> | string;

type StorageListener = (value: PersistenceValue | null) => void;

// Structural match for the SDK's non-exported `PersistenceInternal`. Extends the
// public `Persistence` so it's still accepted by `initializeAuth({ persistence })`,
// while exposing the `_`-methods the SDK calls at runtime (and tests drive).
export interface HostAuthPersistence extends Persistence {
  type: "LOCAL";
  _isAvailable: () => Promise<boolean>;
  _set: (key: string, value: PersistenceValue) => Promise<void>;
  _get: (key: string) => Promise<PersistenceValue | null>;
  _remove: (key: string) => Promise<void>;
  _addListener: (key: string, listener: StorageListener) => void;
  _removeListener: (key: string, listener: StorageListener) => void;
}

export interface HostSessionPersistence {
  /** Pass to `initializeAuth(app, { persistence })`. */
  persistence: HostAuthPersistence;
  /** Load a previously exported blob. Call BEFORE `initializeAuth`. */
  seed: (blob: string) => void;
  /** Serialize the current contents, or `null` when empty (no session). */
  exportBlob: () => string | null;
  /** Notified with the fresh blob (or `null`) whenever the SDK writes/removes. */
  onChange: (cb: (blob: string | null) => void) => () => void;
  /** Drop all contents (used when tearing down the Firebase app). */
  clear: () => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const isPersistenceValue = (value: unknown): value is PersistenceValue => typeof value === "string" || isRecord(value);

export const createHostSessionPersistence = (): HostSessionPersistence => {
  const store = new Map<string, PersistenceValue>();
  const listeners = new Set<(blob: string | null) => void>();

  const exportBlob = (): string | null => (store.size === 0 ? null : JSON.stringify(Object.fromEntries(store)));

  const notify = (): void => {
    const blob = exportBlob();
    listeners.forEach((listener) => listener(blob));
  };

  const persistence: HostAuthPersistence = {
    type: "LOCAL",
    _isAvailable: () => Promise.resolve(true),
    _set: async (key, value) => {
      store.set(key, value);
      notify();
    },
    _get: async (key) => store.get(key) ?? null,
    _remove: async (key) => {
      store.delete(key);
      notify();
    },
    // Node has no cross-tab storage events, so there's nothing to observe; the
    // SDK still calls these, so they must exist as no-ops.
    _addListener: () => undefined,
    _removeListener: () => undefined,
  };

  const seed = (blob: string): void => {
    const parsed: unknown = JSON.parse(blob);
    if (!isRecord(parsed)) throw new Error("host session blob must be a JSON object");
    store.clear();
    for (const [key, value] of Object.entries(parsed)) {
      if (isPersistenceValue(value)) store.set(key, value);
    }
  };

  const onChange = (listener: (blob: string | null) => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const clear = (): void => {
    store.clear();
  };

  return { persistence, seed, exportBlob, onChange, clear };
};
