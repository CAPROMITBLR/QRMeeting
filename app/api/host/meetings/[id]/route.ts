import { apiError, json } from "@/lib/http";
import { sql } from "@/lib/db";
import { getHost } from "@/lib/host-session";
import { isUuid } from "@/lib/validation";

/** Removes a meeting from the signed-in host's list (the host link keeps working). */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/host/meetings/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return apiError(404, "not_found", "This meeting does not exist.");

  const host = await getHost();
  if (!host) return apiError(401, "not_signed_in", "Sign in first to manage your meetings.");

  try {
    await sql`
      update public.meetings
      set host_id = null
      where id = ${id} and host_id = ${host.id}
    `;
    return json({ ok: true });
  } catch (error) {
    console.error("remove meeting from host failed", error);
    return apiError(500, "server_error", "Could not remove this meeting from your list.");
  }
}
