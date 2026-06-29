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

// Returns whether the POST reached the server with a 2xx. Callers that don't care
// (most) can ignore it; the identity-fallback path awaits it to know the identity
// landed so it can stop re-attaching it to subsequent events.
export function sendPost(
  url: string,
  data: unknown,
  apiKey: string
): Promise<boolean> {
  if (!isBrowser) return Promise.resolve(false);

  try {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(data),
      keepalive: true,
    })
      .then((res) => res.ok)
      .catch(() => false);
  } catch {
    // JSON.stringify can throw on circular refs — never propagate
    return Promise.resolve(false);
  }
}
