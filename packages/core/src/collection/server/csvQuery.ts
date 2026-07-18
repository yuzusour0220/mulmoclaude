// Compile a validated CollectionQuery (the structured aggregation DSL,
// `core/queryZ.ts`) into DuckDB SQL over `read_csv`. Safety model:
//   - column names / aliases → double-quoted identifiers (quoteIdent);
//   - every comparison VALUE → a prepared-statement parameter;
//   - the file path is bound by the EXECUTOR as the first parameter;
//   - the DSL itself can't name a table function, so no query can reach
//     any file other than the one the executor binds.
// Pure + exported for unit tests — no filesystem, no DuckDB here.

import type { CollectionQuery, CollectionQueryAggregate, CollectionQueryWhere } from "../core/queryZ";
import { DEFAULT_QUERY_ROWS } from "../core/queryZ";

/** Double-quote a SQL identifier (CSV column name / result alias). */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Single-quote a SQL string literal (a `types={...}` struct key). */
export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** The `read_csv` argument list shared by every CSV query: the (prepared)
 *  path plus a `types` pin forcing the key column to VARCHAR — without it
 *  DuckDB's sniffer turns `001` into BIGINT 1, so leading zeros vanish
 *  and distinct keys collapse. */
export function readCsvArgs(primaryKey: string): string {
  return `?, types={${quoteLiteral(primaryKey)}: 'VARCHAR'}`;
}

/** One aggregate's SQL expression. `sum`/`avg` TRY_CAST to DOUBLE so a
 *  column the sniffer kept as VARCHAR (mixed values) aggregates over its
 *  numeric cells instead of erroring; non-numeric cells become NULL and
 *  are skipped — standard BI tolerance. `min`/`max` stay native (they are
 *  meaningful on strings and dates too). */
function aggregateExpr(aggregate: CollectionQueryAggregate): string {
  const { op, column } = aggregate;
  if (op === "count") return column === undefined ? "count(*)" : `count(${quoteIdent(column)})`;
  if (op === "sum" || op === "avg") return `${op}(TRY_CAST(${quoteIdent(column ?? "")} AS DOUBLE))`;
  return `${op}(${quoteIdent(column ?? "")})`;
}

/** One where condition → SQL fragment + its bound parameters. String
 *  equality compares against `CAST(col AS VARCHAR)` so a sniffer-typed
 *  column still matches its textual value; numeric/boolean values compare
 *  natively (DuckDB coerces the column side). */
function whereFragment(cond: CollectionQueryWhere): { sql: string; params: unknown[] } {
  const column = quoteIdent(cond.field);
  const asText = `CAST(${column} AS VARCHAR)`;
  if (cond.op === "in") {
    const values = cond.value as (string | number)[];
    const textual = values.every((value) => typeof value === "string");
    const lhs = textual ? asText : column;
    return { sql: `${lhs} IN (${values.map(() => "?").join(", ")})`, params: values };
  }
  if (cond.op === "contains") return { sql: `contains(${asText}, ?)`, params: [String(cond.value)] };
  const operator = { eq: "=", ne: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[cond.op];
  const lhs = typeof cond.value === "string" && (cond.op === "eq" || cond.op === "ne") ? asText : column;
  return { sql: `${lhs} ${operator} ?`, params: [cond.value] };
}

/** Compile a validated query. Returns the SQL (whose FIRST placeholder is
 *  the CSV path — the executor binds it) and the where-value parameters
 *  that follow it. Callers MUST have run `CollectionQueryZ` first; this
 *  function trusts the shape (aliases already charset-checked, orderBy
 *  membership already enforced). */
export function compileCsvQuery(query: CollectionQuery, primaryKey: string): { sql: string; params: unknown[] } {
  const groupBy = query.groupBy ?? [];
  const aggregates = Object.entries(query.aggregates ?? {});
  const selectList = [...groupBy.map(quoteIdent), ...aggregates.map(([alias, aggregate]) => `${aggregateExpr(aggregate)} AS ${quoteIdent(alias)}`)];
  const where = (query.where ?? []).map(whereFragment);
  const clauses = [`SELECT ${selectList.join(", ")}`, `FROM read_csv(${readCsvArgs(primaryKey)})`];
  if (where.length > 0) clauses.push(`WHERE ${where.map((fragment) => fragment.sql).join(" AND ")}`);
  if (groupBy.length > 0) clauses.push(`GROUP BY ${groupBy.map(quoteIdent).join(", ")}`);
  const orderBy = (query.orderBy ?? []).map((order) => quoteIdent(order.field) + (order.dir === "desc" ? " DESC" : " ASC"));
  if (orderBy.length > 0) clauses.push(`ORDER BY ${orderBy.join(", ")}`);
  clauses.push(`LIMIT ${query.limit ?? DEFAULT_QUERY_ROWS}`);
  return { sql: clauses.join(" "), params: where.flatMap((fragment) => fragment.params) };
}
