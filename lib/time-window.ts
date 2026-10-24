import { EARLY_ENTRY_MINUTES } from "@/lib/config";

export type MeetingWindowState = "not_started" | "closed" | "open";

export function meetingWindowState(
  now: Date,
  startsAt: Date,
  isOpen: boolean,
  closesAt: Date | null,
): MeetingWindowState {
  if (now.getTime() < startsAt.getTime() - EARLY_ENTRY_MINUTES * 60_000) return "not_started";
  if (!isOpen || (closesAt !== null && now.getTime() >= closesAt.getTime())) return "closed";
  return "open";
}
