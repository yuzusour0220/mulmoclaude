// Minimal fake Request / Response factories for unit-testing Express
// middleware without pulling in supertest.
//
// The `headers` value type is intentionally widened to `unknown` so
// tests can simulate header-smuggling-style malformed values (e.g. an
// array Origin) even though Express's runtime type is
// `string | string[]`. The middleware-under-test only touches
// `method`, `headers`, `status`, `json`, so casting through `unknown`
// at the call site is safe.
//
// Used by:
//   - test/server/test_csrfGuard.ts (factory + env-binding suite)
//   - test/server/test_csrfGuard_env_wiring.ts (export-site wiring smoke, #1463)

export interface FakeReq {
  method: string;
  headers: Record<string, unknown>;
}

export interface FakeRes {
  statusCode: number;
  body: unknown;
  status: (code: number) => FakeRes;
  json: (payload: unknown) => FakeRes;
}

export function makeReq(method: string, origin?: string): FakeReq {
  return {
    method,
    headers: origin === undefined ? {} : { origin },
  };
}

// Raw-Origin variant: lets a test inject an Array / non-string Origin
// value to exercise the header-smuggling rejection path. Required
// because `makeReq`'s `origin` parameter is typed `string | undefined`.
export function makeReqWithRawOrigin(method: string, rawOrigin: unknown): FakeReq {
  return {
    method,
    headers: { origin: rawOrigin },
  };
}

export function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}
