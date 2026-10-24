export type MeetingWindowState = "closed" | "open";

export function meetingWindowState(
  now: Date,
  _startsAt: Date,
  isOpen: boolean,
  closesAt: Date | null,
): MeetingWindowState {
  if (!isOpen || (closesAt !== null && now.getTime() >= closesAt.getTime())) return "closed";
  return "open";
}
