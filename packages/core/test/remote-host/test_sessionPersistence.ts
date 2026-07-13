// Unit tests for the export/seed-able Firebase Auth persistence
// (createHostSessionPersistence) that lets a host's session be parked in the
// browser and restored after a restart (mulmoserver#50, case A').
//
// We drive the same `_set`/`_get`/`_remove` the SDK calls, plus the seed/export
// round-trip and the onChange signal — no Firebase needed.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createHostSessionPersistence } from "../../src/remote-host/server/sessionPersistence.js";

const AUTH_KEY = "firebase:authUser:apiKey:remote-host-1";
const userValue = { uid: "u1", stsTokenManager: { refreshToken: "rt" } };

describe("createHostSessionPersistence", () => {
  it("advertises itself as durable (LOCAL) and available so the SDK persists the user", async () => {
    const { persistence } = createHostSessionPersistence();
    assert.equal(persistence.type, "LOCAL");
    assert.equal(await persistence._isAvailable(), true);
  });

  it("_set / _get / _remove round-trip a value", async () => {
    const { persistence } = createHostSessionPersistence();
    assert.equal(await persistence._get(AUTH_KEY), null);
    await persistence._set(AUTH_KEY, userValue);
    assert.deepEqual(await persistence._get(AUTH_KEY), userValue);
    await persistence._remove(AUTH_KEY);
    assert.equal(await persistence._get(AUTH_KEY), null);
  });

  it("exportBlob is null when empty and JSON of the store otherwise", async () => {
    const { persistence, exportBlob } = createHostSessionPersistence();
    assert.equal(exportBlob(), null);
    await persistence._set(AUTH_KEY, userValue);
    assert.deepEqual(JSON.parse(exportBlob() ?? "null"), { [AUTH_KEY]: userValue });
  });

  it("seed restores contents from a blob before init, and export round-trips it", async () => {
    const source = createHostSessionPersistence();
    await source.persistence._set(AUTH_KEY, userValue);
    const blob = source.exportBlob();
    assert.ok(blob);

    const restored = createHostSessionPersistence();
    restored.seed(blob);
    assert.deepEqual(await restored.persistence._get(AUTH_KEY), userValue);
    assert.equal(restored.exportBlob(), blob);
  });

  it("seed replaces any existing contents (last-write-wins)", async () => {
    const { persistence, seed, exportBlob } = createHostSessionPersistence();
    await persistence._set("stale", "old");
    seed(JSON.stringify({ [AUTH_KEY]: userValue }));
    assert.equal(await persistence._get("stale"), null);
    assert.deepEqual(JSON.parse(exportBlob() ?? "null"), { [AUTH_KEY]: userValue });
  });

  it("seed rejects a non-object blob", () => {
    const { seed } = createHostSessionPersistence();
    assert.throws(() => seed("[1,2,3]"), /must be a JSON object/);
    assert.throws(() => seed('"a string"'), /must be a JSON object/);
    assert.throws(() => seed("not json"));
  });

  it("onChange fires with the fresh blob on set and remove, and stops after unsubscribe", async () => {
    const { persistence, onChange } = createHostSessionPersistence();
    const seen: (string | null)[] = [];
    const unsubscribe = onChange((blob) => seen.push(blob));

    await persistence._set(AUTH_KEY, userValue);
    await persistence._remove(AUTH_KEY);
    assert.equal(seen.length, 2);
    assert.deepEqual(JSON.parse(seen[0] ?? "null"), { [AUTH_KEY]: userValue });
    assert.equal(seen[1], null); // removing the last key → empty → null (tells the browser to drop it)

    unsubscribe();
    await persistence._set(AUTH_KEY, userValue);
    assert.equal(seen.length, 2); // no further notifications
  });

  it("clear empties the store without firing onChange", async () => {
    const { persistence, onChange, clear, exportBlob } = createHostSessionPersistence();
    const seen: (string | null)[] = [];
    onChange((blob) => seen.push(blob));
    await persistence._set(AUTH_KEY, userValue);
    seen.length = 0;

    clear();
    assert.equal(exportBlob(), null);
    assert.equal(seen.length, 0);
  });
});
