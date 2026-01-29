const isBrowser = typeof window !== "undefined";

function generateId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getVisitorId(): string {
  if (!isBrowser) return "";

  const storageKey = "hm_visitor_id";
  let visitorId = localStorage.getItem(storageKey);

  if (!visitorId) {
    visitorId = generateId();
    localStorage.setItem(storageKey, visitorId);
  }

  return visitorId;
}

export function getSessionId(timeout: number): string {
  if (!isBrowser) return "";

  const storageKey = "hm_session_id";
  const timestampKey = "hm_session_timestamp";

  let sessionId = sessionStorage.getItem(storageKey);
  const lastTimestamp = sessionStorage.getItem(timestampKey);
  const now = Date.now();

  if (
    !sessionId ||
    !lastTimestamp ||
    now - parseInt(lastTimestamp) > timeout
  ) {
    sessionId = generateId();
    sessionStorage.setItem(storageKey, sessionId);
  }

  sessionStorage.setItem(timestampKey, now.toString());
  return sessionId;
}

export function generatePageViewId(): string {
  return generateId();
}
