import { apiError, getBaseUrl } from "@/lib/http";
import { sql } from "@/lib/db";
import { hostKeyMatches, readHostKey } from "@/lib/host-key";
import { attendeeUrl, qrFileName, qrPng } from "@/lib/qr";
import { isUuid } from "@/lib/validation";

export async function GET(request: Request, ctx: RouteContext<"/api/meetings/[id]/qr.png">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return apiError(403, "forbidden", "This host link is not valid.");

  try {
    const [meeting] = await sql<{ title: string; host_token: string }[]>`
      select title, host_token from public.meetings where id = ${id}
    `;

    if (!meeting || !hostKeyMatches(readHostKey(request.url), meeting.host_token)) {
      return apiError(403, "forbidden", "This host link is not valid.");
    }

    const png = await qrPng(attendeeUrl(getBaseUrl(request), id));
    const fileName = qrFileName(meeting.title, id);

    return new Response(new Uint8Array(png), {
      headers: {
        "content-type": "image/png",
        "content-length": String(png.byteLength),
        "content-disposition": `attachment; filename="${fileName.replace(/[^\x20-\x7E]/g, "")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("qr generation failed", error);
    return apiError(500, "server_error", "Could not generate the QR code.");
  }
}
