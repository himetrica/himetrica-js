const isBrowser = typeof window !== "undefined";

export function sendBeacon(url: string, data: unknown): void {
  if (!isBrowser) return;

  try {
    const payload = JSON.stringify(data);

    if (navigator.sendBeacon) {
      const sent = navigator.sendBeacon(
        url,
        new Blob([payload], { type: "application/json" })
      );
      // sendBeacon returns false if the browser couldn't queue it (payload too large, etc.)
      // Fall back to fetch in that case
      if (!sent) {
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    } else {
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // JSON.stringify can throw on circular refs, sendBeacon can throw — never propagate
  }
}

export function sendPost(
  url: string,
  data: unknown,
  apiKey: string
): void {
  if (!isBrowser) return;

  try {
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(data),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // JSON.stringify can throw on circular refs — never propagate
  }
}
