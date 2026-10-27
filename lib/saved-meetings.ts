/**
 * With no host accounts, this browser is where a host's own links live. The
 * host link is the credential, so only { id, title, key } is kept, in
 * localStorage, and nothing about it is sent anywhere on its own.
 *
 * Client-only: every function guards against storage being blocked.
 */

export type SavedMeeting = {
  id: string;
  title: string;
  key: string;
  savedAt: string;
};

/** Same key older versions used, so previously saved links still show up. */
const STORAGE_KEY = "mqr-host-links";
const MAX_SAVED = 50;

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Parses whatever is in storage; anything malformed is dropped, never thrown. */
export function parseSavedMeetings(raw: string | null): SavedMeeting[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];

    const seen = new Set<string>();
    const meetings: SavedMeeting[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Partial<SavedMeeting>;
      const id = clean(entry.id, 64);
      const key = clean(entry.key, 200);
      if (!id || key.length < 20 || seen.has(id)) continue;
      seen.add(id);
      meetings.push({
        id,
        key,
        title: clean(entry.title, 120) || "Meeting",
        savedAt: clean(entry.savedAt, 40),
      });
      if (meetings.length >= MAX_SAVED) break;
    }
    return meetings;
  } catch {
    return [];
  }
}

function write(meetings: SavedMeeting[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(meetings.slice(0, MAX_SAVED)));
  } catch {
    // Storage blocked (private mode / privacy settings): the list is just empty.
  }
}

export function readSavedMeetings(): SavedMeeting[] {
  try {
    return parseSavedMeetings(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Adds or refreshes a meeting, newest first. */
export function saveMeeting(entry: { id: string; title: string; key: string }): void {
  const existing = readSavedMeetings().filter((meeting) => meeting.id !== entry.id);
  write([{ ...entry, savedAt: new Date().toISOString() }, ...existing]);
}

export function forgetMeeting(id: string): void {
  write(readSavedMeetings().filter((meeting) => meeting.id !== id));
}

export function meetingHref(meeting: Pick<SavedMeeting, "id" | "key">): string {
  return `/meetings/${meeting.id}?key=${encodeURIComponent(meeting.key)}`;
}
