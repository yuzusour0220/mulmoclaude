// Unit tests for the pure `where` predicate
// (packages/core/src/collection/core/where.ts) — the AND-of-conditions
// matcher behind `DynamicIconSource.where` / `DynamicIconRule.where`. No
// fs, no server state.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { matchesWhere, type Where } from "@mulmoclaude/core/collection";

describe("matchesWhere", () => {
  it("eq: true when the field equals the value, false otherwise", () => {
    const where: Where = [{ field: "status", op: "eq", value: "done" }];
    assert.equal(matchesWhere(where, { status: "done" }), true);
    assert.equal(matchesWhere(where, { status: "open" }), false);
  });

  it("ne: true when the field differs from the value, false when equal", () => {
    const where: Where = [{ field: "status", op: "ne", value: "done" }];
    assert.equal(matchesWhere(where, { status: "open" }), true);
    assert.equal(matchesWhere(where, { status: "done" }), false);
  });

  it("in: true when the field is one of the values, false otherwise", () => {
    const where: Where = [{ field: "condition", op: "in", value: ["rain", "snow"] }];
    assert.equal(matchesWhere(where, { condition: "rain" }), true);
    assert.equal(matchesWhere(where, { condition: "sunny" }), false);
  });

  it("gt: true when the numeric field is greater, false otherwise", () => {
    const where: Where = [{ field: "temp", op: "gt", value: "20" }];
    assert.equal(matchesWhere(where, { temp: "25" }), true);
    assert.equal(matchesWhere(where, { temp: "20" }), false);
    assert.equal(matchesWhere(where, { temp: "15" }), false);
  });

  it("gte: true when the numeric field is greater or equal, false otherwise", () => {
    const where: Where = [{ field: "temp", op: "gte", value: "20" }];
    assert.equal(matchesWhere(where, { temp: "20" }), true);
    assert.equal(matchesWhere(where, { temp: "19" }), false);
  });

  it("lt: true when the numeric field is less, false otherwise", () => {
    const where: Where = [{ field: "temp", op: "lt", value: "20" }];
    assert.equal(matchesWhere(where, { temp: "15" }), true);
    assert.equal(matchesWhere(where, { temp: "20" }), false);
  });

  it("lte: true when the numeric field is less or equal, false otherwise", () => {
    const where: Where = [{ field: "temp", op: "lte", value: "20" }];
    assert.equal(matchesWhere(where, { temp: "20" }), true);
    assert.equal(matchesWhere(where, { temp: "21" }), false);
  });

  it("contains: true when the field substring-matches, false otherwise", () => {
    const where: Where = [{ field: "title", op: "contains", value: "storm" }];
    assert.equal(matchesWhere(where, { title: "tropical storm warning" }), true);
    assert.equal(matchesWhere(where, { title: "clear skies" }), false);
  });

  it("MISSING field: ne is true, every other op is false", () => {
    assert.equal(matchesWhere([{ field: "x", op: "ne", value: "a" }], {}), true);
    assert.equal(matchesWhere([{ field: "x", op: "eq", value: "a" }], {}), false);
    assert.equal(matchesWhere([{ field: "x", op: "in", value: ["a"] }], {}), false);
    assert.equal(matchesWhere([{ field: "x", op: "gt", value: "1" }], {}), false);
    assert.equal(matchesWhere([{ field: "x", op: "gte", value: "1" }], {}), false);
    assert.equal(matchesWhere([{ field: "x", op: "lt", value: "1" }], {}), false);
    assert.equal(matchesWhere([{ field: "x", op: "lte", value: "1" }], {}), false);
    assert.equal(matchesWhere([{ field: "x", op: "contains", value: "a" }], {}), false);
  });

  it("MISSING field: undefined and null are both treated as missing", () => {
    assert.equal(matchesWhere([{ field: "x", op: "ne", value: "a" }], { x: undefined }), true);
    assert.equal(matchesWhere([{ field: "x", op: "ne", value: "a" }], { x: null }), true);
    assert.equal(matchesWhere([{ field: "x", op: "eq", value: "a" }], { x: null }), false);
  });

  it("numeric comparisons with a non-numeric value are false, not thrown", () => {
    assert.equal(matchesWhere([{ field: "temp", op: "gt", value: "cold" }], { temp: "25" }), false);
    assert.equal(matchesWhere([{ field: "temp", op: "gt", value: "20" }], { temp: "warm" }), false);
    assert.equal(matchesWhere([{ field: "temp", op: "lte", value: "20" }], { temp: "" }), false);
  });

  it("multi-condition AND: true only when every condition matches", () => {
    const where: Where = [
      { field: "condition", op: "eq", value: "rain" },
      { field: "temp", op: "gte", value: "10" },
    ];
    assert.equal(matchesWhere(where, { condition: "rain", temp: "12" }), true);
    assert.equal(matchesWhere(where, { condition: "rain", temp: "5" }), false);
    assert.equal(matchesWhere(where, { condition: "sunny", temp: "12" }), false);
  });

  it("an empty where array matches everything", () => {
    assert.equal(matchesWhere([], {}), true);
    assert.equal(matchesWhere([], { anything: "goes" }), true);
  });
});
