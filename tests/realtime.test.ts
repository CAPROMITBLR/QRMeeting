import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { meetingBroadcastBody, notifyMeetingChanged, realtimeConfig } from "../lib/realtime";
import { MEETING_EVENT, meetingTopic } from "../lib/realtime-topic";

const KEY_NAMES = [
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "PROJECT_URL",
] as const;

const MEETING_ID = "11111111-1111-4111-8111-111111111111";

function setEnv(values: Partial<Record<(typeof KEY_NAMES)[number], string>>) {
  for (const name of KEY_NAMES) {
    const value = values[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

beforeEach(() => setEnv({}));
afterEach(() => {
  setEnv({});
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("meetingTopic", () => {
  it("scopes the channel to one meeting", () => {
    expect(meetingTopic(MEETING_ID)).toBe(`meeting:${MEETING_ID}`);
  });
});

describe("realtimeConfig", () => {
  it("is null when the key is missing, so the host page can fall back to polling", () => {
    setEnv({ PROJECT_URL: "https://example.supabase.co" });
    expect(realtimeConfig()).toBeNull();
  });

  it("is null when the project url is missing", () => {
    setEnv({ SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
    expect(realtimeConfig()).toBeNull();
  });

  it("normalises a trailing slash and accepts the publishable key", () => {
    setEnv({ PROJECT_URL: "https://example.supabase.co/", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
    expect(realtimeConfig()).toEqual({ url: "https://example.supabase.co", key: "sb_publishable_test" });
  });

  it("falls back to the legacy anon key name", () => {
    setEnv({ PROJECT_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon_test" });
    expect(realtimeConfig()?.key).toBe("anon_test");
  });
});

describe("meetingBroadcastBody", () => {
  it("broadcasts only the change kind, never attendee data", () => {
    const body = meetingBroadcastBody(MEETING_ID, "attendance");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toEqual({
      topic: `meeting:${MEETING_ID}`,
      event: MEETING_EVENT,
      payload: { kind: "attendance" },
    });
    expect(JSON.stringify(body)).not.toMatch(/name|lat|lng|accuracy/);
  });
});

describe("notifyMeetingChanged", () => {
  it("does nothing when realtime is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await notifyMeetingChanged(MEETING_ID, "request")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the batch payload with the publishable key", async () => {
    setEnv({ PROJECT_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await notifyMeetingChanged(MEETING_ID, "meeting")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.supabase.co/realtime/v1/api/broadcast");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe("sb_publishable_test");
    expect(headers.authorization).toBe("Bearer sb_publishable_test");
    expect(JSON.parse(String(init.body))).toEqual(meetingBroadcastBody(MEETING_ID, "meeting"));
  });

  it("swallows transport failures so a mark is never rolled back", async () => {
    setEnv({ PROJECT_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket down")));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await notifyMeetingChanged(MEETING_ID, "attendance")).toBe(false);
  });

  it("reports a non-2xx broadcast without throwing", async () => {
    setEnv({ PROJECT_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 401 })));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await notifyMeetingChanged(MEETING_ID, "attendance")).toBe(false);
  });
});
