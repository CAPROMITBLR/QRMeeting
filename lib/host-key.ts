import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 random bytes -> 43 URL-safe characters. */
export function generateHostKey(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Constant-time comparison of the key supplied in the URL against the stored one.
 * Both sides are hashed first so differing lengths cannot leak through timing.
 */
export function hostKeyMatches(provided: string | null | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** Reads `?key=` from a request URL. Accepts repeats but only uses the first. */
export function readHostKey(url: string | URL): string | null {
  const value = new URL(url).searchParams.get("key");
  return value && value.length <= 200 ? value : null;
}
