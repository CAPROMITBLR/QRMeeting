import { apiError, json } from "@/lib/http";
import { sql } from "@/lib/db";
import { hashPassphrase, startHostSession, destroyHostSession, verifyPassphrase } from "@/lib/host-session";
import { hostAuthRateLimiter } from "@/lib/rate-limit";
import { firstIssueMessage, hostCredentialsSchema } from "@/lib/schemas";
import { checkRateLimit, readJson } from "@/lib/request";

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

/** Sign up or sign in. Both set the HttpOnly host session cookie. */
export async function POST(request: Request) {
  const limited = await checkRateLimit(
    request,
    hostAuthRateLimiter,
    "Too many sign-in attempts. Please wait a moment and try again.",
  );
  if (limited) return limited;

  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = hostCredentialsSchema.safeParse(body);
  if (!parsed.success) return apiError(400, "invalid_input", firstIssueMessage(parsed.error).message);

  const { name, passphrase, mode } = parsed.data;

  try {
    const [existing] = await sql<{ id: string; name: string; passphrase_hash: string }[]>`
      select id, name, passphrase_hash
      from public.hosts
      where lower(btrim(name)) = lower(btrim(${name}))
      limit 1
    `;

    if (mode === "signup") {
      if (existing) {
        return apiError(
          409,
          "name_taken",
          "That host name is already taken. Sign in instead, or choose another name.",
        );
      }
      const [created] = await sql<{ id: string; name: string }[]>`
        insert into public.hosts (name, passphrase_hash)
        values (${name}, ${hashPassphrase(passphrase)})
        returning id, name
      `;
      await startHostSession(created.id);
      return json({ host: { id: created.id, name: created.name } }, { status: 201 });
    }

    if (!existing) {
      return apiError(
        401,
        "unknown_host",
        "No host account uses that name yet. Create one with the same name and passphrase.",
      );
    }
    if (!verifyPassphrase(passphrase, existing.passphrase_hash)) {
      return apiError(401, "bad_passphrase", "That passphrase does not match this host name. Try again.");
    }

    await startHostSession(existing.id);
    return json({ host: { id: existing.id, name: existing.name } });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return apiError(409, "name_taken", "That host name is already taken. Sign in instead.");
    }
    console.error("host session failed", error);
    return apiError(500, "server_error", "Could not sign you in right now. Please try again.");
  }
}

export async function DELETE() {
  try {
    await destroyHostSession();
    return json({ ok: true });
  } catch (error) {
    console.error("host sign-out failed", error);
    return apiError(500, "server_error", "Could not sign out. Please try again.");
  }
}
