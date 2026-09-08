import { decode, verifyWithJwks } from "hono/jwt";
import { createBrokerRequest } from "./broker-context";

export type AuthBindings = {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  APP_ORIGIN?: string;
  ARGUS_LOCAL_DEV?: string;
};
export type Session = { owner: string; label: string; local: boolean; expiresAt: number };
export class AuthError extends Error {
  constructor(public status: 401 | 403 | 503, public code: string) { super(code); }
}

function origin(value: string | undefined): string {
  try {
    const url = new URL(value!);
    if (url.protocol === "https:" && !url.username && !url.password && (value === url.origin || value === `${url.origin}/`)) return url.origin;
  } catch {}
  throw new AuthError(503, "auth_not_configured");
}

export function createAuthenticator(fetcher: typeof fetch = fetch) {
  const request = createBrokerRequest(fetcher);
  type Keys = NonNullable<Parameters<typeof verifyWithJwks>[1]["keys"]>;
  // ponytail: one Access issuer per Worker; keep one bounded key cache, not tenant configuration storage.
  let cache: { issuer: string; fetchedAt: number; expiresAt: number; keys: Promise<Keys> } | undefined;
  function load(issuer: string) {
    const keys = request(`${issuer}/cdn-cgi/access/certs`, undefined, 65_536).then(data => {
      if (!Array.isArray(data?.keys) || !data.keys.length || data.keys.length > 16 || data.keys.some((key: Record<string, unknown>) => !key || typeof key !== "object" || typeof key.kid !== "string" || key.kid.length > 256 || key.kty !== "RSA" || typeof key.n !== "string" || typeof key.e !== "string")) throw new AuthError(503, "auth_keys_unavailable");
      return data.keys as Keys;
    }).catch(() => {
      if (cache?.keys === keys) cache.expiresAt = Date.now() + 30_000;
      throw new AuthError(503, "auth_keys_unavailable");
    });
    cache = { issuer, fetchedAt: Date.now(), expiresAt: Date.now() + 300_000, keys };
    return cache;
  }
  return async (incoming: Request, env: AuthBindings): Promise<Session> => {
    const url = new URL(incoming.url);
    if (!env.ACCESS_TEAM_DOMAIN && !env.ACCESS_AUD && env.ARGUS_LOCAL_DEV === "true" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      // Loopback development connections renew authentication with a new request after one hour.
      return { owner: "local-development", label: "Local development", local: true, expiresAt: Date.now() + 3_600_000 };
    }
    const issuer = origin(env.ACCESS_TEAM_DOMAIN);
    if (url.origin !== origin(env.APP_ORIGIN)) throw new AuthError(403, "origin_rejected");
    if (!env.ACCESS_AUD?.trim()) throw new AuthError(503, "auth_not_configured");
    const token = incoming.headers.get("Cf-Access-Jwt-Assertion");
    if (!token || token.length > 16_384) throw new AuthError(401, "authentication_required");
    let kid: string;
    try {
      const { header } = decode(token);
      if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid || header.kid.length > 256) throw new Error();
      kid = header.kid;
    } catch { throw new AuthError(401, "invalid_identity"); }
    let entry = cache;
    if (!entry || entry.issuer !== issuer || Date.now() >= entry.expiresAt) entry = load(issuer);
    let keys = await entry.keys;
    if (!keys.some(key => key.kid === kid) && Date.now() - entry.fetchedAt >= 30_000) {
      keys = await (cache?.issuer === issuer && cache !== entry ? cache : load(issuer)).keys;
    }
    try {
      const payload = await verifyWithJwks(token, { keys, allowedAlgorithms: ["RS256"], verification: { iss: issuer, aud: env.ACCESS_AUD, exp: true, nbf: true, iat: true } });
      if (typeof payload.sub !== "string" || !payload.sub.trim() || payload.sub.length > 256 || typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000) throw new Error();
      const expiresAt = Math.floor(payload.exp * 1000);
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error();
      return { owner: JSON.stringify([issuer, payload.sub]), label: typeof payload.email === "string" && payload.email.length <= 254 ? payload.email : "Private user", local: false, expiresAt };
    } catch { throw new AuthError(401, "invalid_identity"); }
  };
}

export function checkRequestOrigin(request: Request, env: AuthBindings, session: Session): void {
  if (new URL(request.url).pathname.startsWith("/api/") && request.headers.get("Sec-Fetch-Site") === "cross-site") throw new AuthError(403, "origin_rejected");
  if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    const expected = session.local ? new URL(request.url).origin : origin(env.APP_ORIGIN);
    if (request.headers.get("Origin") !== expected) throw new AuthError(403, "origin_rejected");
    return;
  }
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const expected = session.local ? new URL(request.url).origin : origin(env.APP_ORIGIN);
  if (request.headers.get("Origin") !== expected || request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || request.headers.get("X-ARGUS-Request") !== "1") throw new AuthError(403, "origin_rejected");
}
