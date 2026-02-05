import { onLCP, onINP, onCLS, onFCP, onTTFB } from "web-vitals";
import type { ResolvedConfig } from "./config";
import { getVisitorId, getSessionId } from "./visitor";
import { sendBeacon } from "./transport";

export function setupVitals(config: ResolvedConfig): void {
  if (typeof window === "undefined") return;

  function sendVital(metric: { name: string; value: number; rating: string }) {
    const url = `${config.apiUrl}/api/track/vitals?apiKey=${config.apiKey}`;
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

  onTTFB(sendVital);
  onFCP(sendVital);
  onLCP(sendVital);
  onCLS(sendVital);
  onINP(sendVital);
}
