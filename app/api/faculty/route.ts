import { apiError, json } from "@/lib/http";

type FacultyMember = {
  facultyId: string;
  name: string;
  email?: string;
  department?: string;
};

export async function GET() {
  const rosterUrl = process.env.GOOGLE_SHEETS_FACULTY_URL?.trim();
  if (!rosterUrl) return json({ members: [] });

  try {
    const response = await fetch(rosterUrl, {
      next: { revalidate: 300 },
    });
    if (!response.ok) return apiError(502, "roster_failed", "Could not load the faculty roster.");

    const body: unknown = await response.json();
    if (!Array.isArray(body)) return apiError(502, "roster_failed", "The faculty roster has an invalid format.");

    const members = body
      .filter(isFacultyMember)
      .slice(0, 2_000)
      .map((member) => ({ facultyId: member.facultyId, name: member.name }));
    return json({ members }, { headers: { "cache-control": "private, max-age=300" } });
  } catch (error) {
    console.error("faculty roster failed", error);
    return apiError(502, "roster_failed", "Could not load the faculty roster.");
  }
}

function isFacultyMember(value: unknown): value is FacultyMember {
  if (!value || typeof value !== "object") return false;
  const member = value as Partial<FacultyMember>;
  return typeof member.facultyId === "string" && typeof member.name === "string";
}
