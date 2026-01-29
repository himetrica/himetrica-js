const isBrowser = typeof window !== "undefined";

export function sendBeacon(url: string, data: unknown): void {
  if (!isBrowser) return;

  const payload = JSON.stringify(data);

  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      url,
      new Blob([payload], { type: "application/json" })
    );
  } else {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // Silently fail
    });
  }
}

export function sendPost(
  url: string,
  data: unknown,
  apiKey: string
): void {
  if (!isBrowser) return;

  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(data),
    keepalive: true,
  }).catch(() => {
    // Silently fail
  });
}
