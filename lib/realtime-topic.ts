/**
 * Shared between the server (which broadcasts) and the host page (which
 * subscribes), so it must stay free of server-only imports.
 *
 * Messages are deliberately content-free: a broadcast only says "something
 * changed for this meeting". Attendee data is always read back through the
 * host-key-protected snapshot endpoint.
 */

export const MEETING_EVENT = "change";

export type MeetingChangeKind = "attendance" | "request" | "meeting";

export function meetingTopic(meetingId: string): string {
  return `meeting:${meetingId}`;
}
