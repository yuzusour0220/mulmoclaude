// Unit test for createRemoteHostSession's non-destructive `open` (mulmoserver#50).
//
// The invalid-seed-blob path throws BEFORE any Firebase app is built, so it runs
// without a network: it proves `open` rolls back cleanly and doesn't corrupt the
// session store when a bad blob is handed in (the reconnect contract). The
// Firebase-touching success/restore paths are covered by Phase 2/3 integration.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createRemoteHostSession } from "../../src/remote-host/server/firebase.js";

describe("createRemoteHostSession.open (non-destructive)", () => {
  it("rejects an invalid seed blob and leaves the session store untouched", async () => {
    const session = createRemoteHostSession({ apiKey: "test", projectId: "test", appId: "test" });

    // Valid JSON but not an object → seed throws before any app is initialized.
    await assert.rejects(session.open("[1,2,3]"), /must be a JSON object/);
    assert.equal(session.exportSession(), null, "a failed open must not leave a partial session");

    // Syntactically invalid JSON → JSON.parse throws, same rollback.
    await assert.rejects(session.open("not json"));
    assert.equal(session.exportSession(), null);
  });
});
