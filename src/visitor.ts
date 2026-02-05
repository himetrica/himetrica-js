const isBrowser = typeof window !== "undefined";

function generateId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getCookie(name: string): string | null {
  if (!isBrowser) return null;
  const match = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, maxAge: number, domain: string): void {
  if (!isBrowser) return;
  let cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  if (domain) {
    cookie += `; domain=${domain}`;
  }
  if (location.protocol === "https:") {
    cookie += "; Secure";
  }
  document.cookie = cookie;
}

export function getVisitorId(cookieDomain?: string): string {
  if (!isBrowser) return "";

  if (cookieDomain) {
    let visitorId = getCookie("hm_vid");
    if (!visitorId) {
      // Migrate from localStorage if available
      visitorId = localStorage.getItem("hm_visitor_id");
      if (!visitorId) {
        visitorId = generateId();
      }
      setCookie("hm_vid", visitorId, 365 * 24 * 60 * 60, cookieDomain);
    }
    return visitorId;
  }

  const storageKey = "hm_visitor_id";
  let visitorId = localStorage.getItem(storageKey);

  if (!visitorId) {
    visitorId = generateId();
    localStorage.setItem(storageKey, visitorId);
  }

  return visitorId;
}

export function getSessionId(timeout: number, cookieDomain?: string): string {
  if (!isBrowser) return "";

  const now = Date.now();

  if (cookieDomain) {
    let sessionId = getCookie("hm_sid");
    const lastTimestamp = getCookie("hm_sts");
    const maxAge = Math.round(timeout / 1000); // convert ms to seconds

    if (!sessionId || !lastTimestamp || now - parseInt(lastTimestamp) > timeout) {
      sessionId = generateId();
    }

    setCookie("hm_sid", sessionId, maxAge, cookieDomain);
    setCookie("hm_sts", now.toString(), maxAge, cookieDomain);
    return sessionId;
  }

  const storageKey = "hm_session_id";
  const timestampKey = "hm_session_timestamp";

  let sessionId = sessionStorage.getItem(storageKey);
  const lastTimestamp = sessionStorage.getItem(timestampKey);

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
