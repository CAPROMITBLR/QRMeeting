import "server-only";

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { sql } from "@/lib/db";

export const HOST_COOKIE = "mqr_host";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
const SCRYPT_KEY_LENGTH = 64;

export type HostIdentity = { id: string; name: string };

function normalize(passphrase: string): string {
  return passphrase.normalize("NFKC");
}

/** scrypt hash with a per-host random salt, stored as "scrypt$<salt>$<hash>". */
export function hashPassphrase(passphrase: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(normalize(passphrase), salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPassphrase(passphrase: string, stored: string): boolean {
  const [scheme, salt, digest] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !digest) return false;
  const expected = Buffer.from(digest, "base64url");
  const derived = scryptSync(normalize(passphrase), Buffer.from(salt, "base64url"), expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Inserts a session row and writes the HttpOnly cookie (route handlers only). */
export async function startHostSession(hostId: string): Promise<void> {
  const token = generateSessionToken();
  await sql`
    insert into public.host_sessions (token_hash, host_id)
    values (${hashSessionToken(token)}, ${hostId})
  `;
  const store = await cookies();
  store.set({
    name: HOST_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function destroyHostSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(HOST_COOKIE)?.value;
  if (token) {
    await sql`delete from public.host_sessions where token_hash = ${hashSessionToken(token)}`;
  }
  store.delete(HOST_COOKIE);
}

/** The signed-in host for the current request, or null. */
export async function getHost(): Promise<HostIdentity | null> {
  const store = await cookies();
  const token = store.get(HOST_COOKIE)?.value;
  if (!token || token.length < 20) return null;

  const [host] = await sql<HostIdentity[]>`
    select hosts.id, hosts.name
    from public.host_sessions
    join public.hosts on hosts.id = host_sessions.host_id
    where host_sessions.token_hash = ${hashSessionToken(token)}
    limit 1
  `;
  return host ?? null;
}
