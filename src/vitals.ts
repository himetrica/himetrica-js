import type { ResolvedConfig } from "./config";
import { getVisitorId, getSessionId } from "./visitor";
import { sendBeacon } from "./transport";

export function setupVitals(config: ResolvedConfig): void {
  if (typeof window === "undefined") return;

  function sendVital(metric: { name: string; value: number; rating: string }) {
    const url = `${config.apiUrl}/api/t/v?apiKey=${config.apiKey}`;
    const data = {
      visitorId: getVisitorId(config.cookieDomain),
      sessionId: getSessionId(config.sessionTimeout, config.cookieDomain),
      metric: metric.name,
      value: metric.value,
      rating: metric.rating,
      path: window.location.pathname,
    };
    sendBeacon(url, data);
  }

  // Dynamic import — web-vitals is only loaded when trackVitals is true,
  // so it doesn't increase bundle size for users who don't need it
  import("web-vitals")
    .then(({ onTTFB, onFCP, onLCP, onCLS, onINP }) => {
      onTTFB(sendVital);
      onFCP(sendVital);
      onLCP(sendVital);
      onCLS(sendVital);
      onINP(sendVital);
    })
    .catch(() => {
      // web-vitals not available — silently skip
    });
}
