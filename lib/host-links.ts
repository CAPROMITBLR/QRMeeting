export type SavedMeeting = {
  id: string;
  title: string;
  key: string;
  startsAt: string;
  savedAt: string;
};

const STORAGE_KEY = "mqr-host-links";
const MAX_SAVED = 30;
const EMPTY: SavedMeeting[] = [];

let cache: SavedMeeting[] | null = null;
const listeners = new Set<() => void>();

function isSavedMeeting(value: unknown): value is SavedMeeting {
  const candidate = value as Partial<SavedMeeting> | null;
  return (
    typeof candidate?.id === "string" &&
    typeof candidate?.title === "string" &&
    typeof candidate?.key === "string" &&
    typeof candidate?.startsAt === "string"
  );
}

function parse(raw: string | null): SavedMeeting[] {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return EMPTY;
    return value.filter(isSavedMeeting).slice(0, MAX_SAVED);
  } catch {
    return EMPTY;
  }
}

function write(next: SavedMeeting[]) {
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked; the in-memory list still works for this page view.
  }
  for (const listener of listeners) listener();
}

export function getHostLinks(): SavedMeeting[] {
  if (cache) return cache;
  if (typeof window === "undefined") return EMPTY;
  cache = parse(window.localStorage.getItem(STORAGE_KEY));
  return cache;
}

export function getServerHostLinks(): SavedMeeting[] {
  return EMPTY;
}

export function subscribeHostLinks(listener: () => void): () => void {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function saveHostLink(entry: Omit<SavedMeeting, "savedAt">): void {
  const existing = getHostLinks().filter((item) => item.id !== entry.id);
  write([{ ...entry, savedAt: new Date().toISOString() }, ...existing].slice(0, MAX_SAVED));
}

export function forgetHostLink(id: string): void {
  write(getHostLinks().filter((item) => item.id !== id));
}
