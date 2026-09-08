import { beforeAll, describe, expect, it, vi } from "vitest";
import { sign } from "hono/jwt";
import { AuthError, checkRequestOrigin, createAuthenticator, type AuthBindings } from "../src/auth";
import { createApp } from "../src/worker";

const env: AuthBindings = { ACCESS_TEAM_DOMAIN: "https://argus.cloudflareaccess.com", ACCESS_AUD: "argus-audience", APP_ORIGIN: "https://argus.example.com" };
let privateKey: CryptoKey;
let publicKey: JsonWebKey;
beforeAll(async () => {
  const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  privateKey = keys.privateKey;
  publicKey = { ...await crypto.subtle.exportKey("jwk", keys.publicKey), kid: "first", alg: "RS256" } as JsonWebKey;
});
const claims = () => ({ iss: env.ACCESS_TEAM_DOMAIN, aud: [env.ACCESS_AUD!], sub: "user-one", exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), email: "one@example.com" });
async function token(overrides: Record<string, unknown> = {}, kid = "first") {
  const key = { ...await crypto.subtle.exportKey("jwk", privateKey), kid, alg: "RS256" };
  return sign({ ...claims(), ...overrides }, key, "RS256");
}
const request = (jwt?: string, url = env.APP_ORIGIN!) => new Request(url, { headers: jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {} });
const provider = () => vi.fn<typeof fetch>(async () => Response.json({ keys: [publicKey] }));

describe("private workspace authentication", () => {
  it('restricts safe chain diagnostics to authenticated local development', async () => {
    const app = createApp(provider());
    const local = await app.request('http://localhost:5173/api/chain', {}, { ARGUS_LOCAL_DEV: 'true' });
    expect(local.status).toBe(503);
    expect((await local.json() as any).error.diagnostic).toEqual({ stage: 'storage', reason: 'Quote snapshot storage unavailable' });
    const hosted = await app.request(`${env.APP_ORIGIN}/api/chain`, { headers: { 'Cf-Access-Jwt-Assertion': await token() } }, { ...env, ARGUS_LOCAL_DEV: 'true' });
    expect(hosted.status).toBe(503);
    expect(await hosted.json()).toEqual({ error: { code: 'chain_unavailable', message: 'Real option pricing is unavailable. Your current position is unchanged.' } });
  });
  it("rejects alternate origins before token verification even with a valid identity", async () => {
    const fetcher = provider(), auth = createAuthenticator(fetcher), jwt = await token();
    for (const url of ["https://argus.workers.dev", "https://preview.argus.example.com", "http://argus.example.com", "https://argus.example.com:8443", "http://localhost:5173"]) {
      await expect(auth(request(jwt, url), { ...env, ARGUS_LOCAL_DEV: "true" })).rejects.toMatchObject({ status: 403, code: "origin_rejected" });
    }
    expect(fetcher).not.toHaveBeenCalled();
    await expect(auth(request(jwt, `${env.APP_ORIGIN}/api/bootstrap`), env)).resolves.toMatchObject({ local: false });
  });
  it("requires exact Origin on websocket upgrades without requiring JSON headers", () => {
    const session = { owner: "one", label: "one", local: false, expiresAt: Date.now() + 600000 };
    for (const supplied of [undefined, "https://evil.example"]) {
      const headers = { Upgrade: "websocket", ...(supplied ? { Origin: supplied } : {}) };
      expect(() => checkRequestOrigin(new Request(`${env.APP_ORIGIN}/api/feed`, { headers }), env, session)).toThrow(AuthError);
    }
    expect(() => checkRequestOrigin(new Request(`${env.APP_ORIGIN}/api/feed`, { headers: { Upgrade: "websocket", Origin: env.APP_ORIGIN! } }), env, session)).not.toThrow();
  });
  it("requires configured Access or explicit loopback development, with Access taking precedence", async () => {
    const fetcher = provider();
    const auth = createAuthenticator(fetcher);
    await expect(auth(request(), {})).rejects.toMatchObject({ status: 503 });
    await expect(auth(request(undefined, "http://127.0.0.1:5173"), {})).rejects.toMatchObject({ status: 503 });
    const startedAt = Date.now();
    const local = await auth(request(undefined, "http://127.0.0.1:5173"), { ARGUS_LOCAL_DEV: "true" });
    expect(local).toMatchObject({ local: true });
    expect(local.expiresAt).toBeGreaterThanOrEqual(startedAt + 3600000); expect(local.expiresAt).toBeLessThanOrEqual(Date.now() + 3600000);
    await expect(auth(request(), { ARGUS_LOCAL_DEV: "true" })).rejects.toMatchObject({ status: 503 });
    await expect(auth(request(undefined, "http://localhost:5173"), { ...env, ARGUS_LOCAL_DEV: "true" })).rejects.toMatchObject({ status: 403 });
    await expect(auth(new Request(env.APP_ORIGIN!, { headers: { "Cf-Access-Authenticated-User-Email": "owner@example.com" } }), env)).rejects.toMatchObject({ status: 401 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("verifies signed identities, ignores owner headers, and caches trusted keys", async () => {
    const fetcher = provider();
    const auth = createAuthenticator(fetcher);
    const exp = Math.floor(Date.now() / 1000) + 600;
    const a = await auth(request(await token({ exp })), env);
    const b = await auth(request(await token({ sub: "user-two" })), env);
    expect(a).toEqual({ owner: JSON.stringify([env.ACCESS_TEAM_DOMAIN, "user-one"]), label: "one@example.com", local: false, expiresAt: exp * 1000 });
    expect(a.owner).not.toBe(b.owner);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(`${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });
  it("rejects invalid signature, issuer, audience, dates, subject and missing expiration", async () => {
    const auth = createAuthenticator(provider());
    for (const override of [{ iss: "https://foreign.example" }, { aud: ["foreign"] }, { exp: 0 }, { exp: undefined }, { exp: "9999999999" }, { sub: "" }, { sub: 42 }, { nbf: 9999999999 }, { iat: 9999999999 }]) {
      await expect(auth(request(await token(override)), env)).rejects.toMatchObject({ status: 401 });
    }
    const jwt = await token();
    const parts = jwt.split(".");
    parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
    await expect(auth(request(parts.join(".")), env)).rejects.toMatchObject({ status: 401 });
    await expect(auth(request(await sign(claims(), "untrusted", "HS256")), env)).rejects.toMatchObject({ status: 401 });
  });
  it("rejects oversized tokens and invalid team configuration before fetching", async () => {
    const fetcher = provider();
    const auth = createAuthenticator(fetcher);
    await expect(auth(request("x".repeat(17000)), env)).rejects.toMatchObject({ status: 401 });
    for (const domain of ["http://argus.cloudflareaccess.com", "https://example.com/path", "https://user:secret@example.com", "https://example.com?url=other"]) {
      await expect(auth(request(await token()), { ...env, ACCESS_TEAM_DOMAIN: domain })).rejects.toMatchObject({ status: 503 });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds JWKS errors, response size and key-rotation refresh frequency", async () => {
    const unavailable = createAuthenticator(async () => new Response("unavailable", { status: 503 }));
    await expect(unavailable(request(await token()), env)).rejects.toMatchObject({ status: 503 });
    const oversized = createAuthenticator(async () => new Response("x".repeat(65537)));
    await expect(oversized(request(await token()), env)).rejects.toMatchObject({ status: 503 });
    const fetcher = provider();
    const auth = createAuthenticator(fetcher);
    const old = await token();
    const rotated = await token({}, "rotated");
    await auth(request(old), env);
    await expect(auth(request(rotated), env)).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledOnce();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 31000);
    try {
      fetcher.mockImplementation(async () => Response.json({ keys: [{ ...publicKey, kid: "rotated" }] }));
      await expect(auth(request(rotated), env)).resolves.toMatchObject({ local: false });
      await expect(auth(request(old), env)).rejects.toMatchObject({ status: 401 });
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { clock.mockRestore(); }
  });
  it("requires exact browser mutation origin, JSON and request marker", () => {
    const session = { owner: "test", label: "test", local: false, expiresAt: Date.now() + 600000 };
    const headers = { Origin: env.APP_ORIGIN!, "Content-Type": "application/json", "X-ARGUS-Request": "1", "Sec-Fetch-Site": "same-origin" };
    expect(() => checkRequestOrigin(new Request(`${env.APP_ORIGIN}/api/saved`, { method: "POST", headers }), env, session)).not.toThrow();
    for (const change of [{ Origin: "https://evil.example" }, { Origin: "null" }, { Origin: "" }, { "Content-Type": "text/plain" }, { "X-ARGUS-Request": "" }, { "Sec-Fetch-Site": "cross-site" }]) {
      expect(() => checkRequestOrigin(new Request(`${env.APP_ORIGIN}/api/saved`, { method: "POST", headers: { ...headers, ...change } }), env, session)).toThrow(AuthError);
    }
    expect(() => checkRequestOrigin(new Request(`${env.APP_ORIGIN}/api/chain`, { headers: { "Sec-Fetch-Site": "cross-site" } }), env, session)).toThrow(AuthError);
    expect(() => checkRequestOrigin(new Request(`${env.APP_ORIGIN}/`, { headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate" } }), env, session)).not.toThrow();
    expect(() => checkRequestOrigin(new Request("http://localhost:5173/api/saved", { method: "DELETE", headers: { ...headers, Origin: "http://localhost:5173" } }), {}, { ...session, local: true })).not.toThrow();
  });
  it("coalesces concurrent rotated and unknown-key refresh requests", async () => {
    const fetcher = provider(), auth = createAuthenticator(fetcher);
    await auth(request(await token()), env);
    const rotated = await token({}, "rotated"), unknown = await token({}, "unknown");
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31000);
    try {
      fetcher.mockImplementation(async () => Response.json({ keys: [{ ...publicKey, kid: "rotated" }] }));
      const results = await Promise.allSettled([rotated, unknown, rotated, unknown, rotated, unknown].map(jwt => auth(request(jwt), env)));
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(3);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(3);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { clock.mockRestore(); }
  });
  it("times out unavailable keys and retries after a bounded failure cooldown", async () => {
    const jwt = await token();
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const auth = createAuthenticator(fetcher);
    vi.useFakeTimers();
    try {
      const stalled = expect(auth(request(jwt), env)).rejects.toMatchObject({ status: 503, code: "auth_keys_unavailable" });
      await vi.advanceTimersByTimeAsync(5001);
      await stalled;
      await expect(auth(request(jwt), env)).rejects.toMatchObject({ status: 503 });
      expect(fetcher).toHaveBeenCalledOnce();
      fetcher.mockImplementation(async () => Response.json({ keys: [publicKey] }));
      await vi.advanceTimersByTimeAsync(30001);
      await expect(auth(request(jwt), env)).resolves.toMatchObject({ local: false });
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
