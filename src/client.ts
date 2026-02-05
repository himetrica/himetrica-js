import { type HimetricaConfig, type ResolvedConfig, resolveConfig } from "./config";
import { sendPost, sendBeacon } from "./transport";
import { getVisitorId, getSessionId, generatePageViewId } from "./visitor";
import { captureErrorEvent, captureMessageEvent, setupErrorHandlers } from "./errors";
import { setupVitals } from "./vitals";

const isBrowser = typeof window !== "undefined";

export class HimetricaClient {
  private config: ResolvedConfig;
  private currentPageViewId: string | null = null;
  private pageViewStartTime = 0;
  private lastTrackedPath: string | null = null;
  private autoPageViewsSetup = false;
  private pendingPageViewTimer: ReturnType<typeof setTimeout> | null = null;
  private isFirstPageView = true;
  private static readonly PAGE_VIEW_MIN_DURATION = 3000; // 3 seconds
  private cleanupErrors: (() => void) | null = null;
  // init
  constructor(userConfig: HimetricaConfig) {
    this.config = resolveConfig(userConfig);

    if (!isBrowser) return;

    // Respect Do Not Track
    if (this.config.respectDoNotTrack && navigator.doNotTrack === "1") {
      return;
    }

    if (this.config.autoTrackErrors) {
      this.cleanupErrors = setupErrorHandlers(this.config);
    }

    if (this.config.trackVitals) {
      setupVitals(this.config);
    }

    if (this.config.autoTrackPageViews) {
      this.setupAutoPageViews();
    }
  }

  trackPageView(path?: string): void {
    if (!isBrowser) return;

    const currentPath = path ?? (window.location.pathname + window.location.search);

    // Skip duplicate: same path already tracked
    if (currentPath === this.lastTrackedPath) return;
    this.lastTrackedPath = currentPath;

    // Cancel any pending pageview that didn't meet the minimum duration
    if (this.pendingPageViewTimer) {
      clearTimeout(this.pendingPageViewTimer);
      this.pendingPageViewTimer = null;
    }

    // Send duration for previous page view
    this.sendDuration();

    this.currentPageViewId = generatePageViewId();
    this.pageViewStartTime = Date.now();

    const data = {
      visitorId: getVisitorId(),
      sessionId: getSessionId(this.config.sessionTimeout),
      pageViewId: this.currentPageViewId,
      path: path ?? window.location.pathname,
      title: document.title,
      referrer: this.getOriginalReferrer(),
      queryString: window.location.search,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
    };

    // First pageview sends instantly; subsequent ones wait 3s
    if (!this.isFirstPageView) {
      this.pendingPageViewTimer = setTimeout(() => {
        this.pendingPageViewTimer = null;
        sendPost(`${this.config.apiUrl}/api/track/event`, data, this.config.apiKey);
      }, HimetricaClient.PAGE_VIEW_MIN_DURATION);
    } else {
      this.isFirstPageView = false;
      sendPost(`${this.config.apiUrl}/api/track/event`, data, this.config.apiKey);
    }
  }

  track(eventName: string, properties?: Record<string, unknown>): void {
    if (!isBrowser) return;

    if (!eventName || typeof eventName !== "string") return;
    if (eventName.length > 255) return;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(eventName)) return;

    const data = {
      visitorId: getVisitorId(),
      sessionId: getSessionId(this.config.sessionTimeout),
      eventName,
      properties,
      path: window.location.pathname,
      title: document.title,
      queryString: window.location.search,
    };

    sendPost(`${this.config.apiUrl}/api/track/custom-event`, data, this.config.apiKey);
  }

  identify(data: { name?: string; email?: string; metadata?: Record<string, unknown> }): void {
    if (!isBrowser) return;

    const payload = {
      visitorId: getVisitorId(),
      name: data.name,
      email: data.email,
      metadata: data.metadata,
    };

    sendPost(`${this.config.apiUrl}/api/track/identify`, payload, this.config.apiKey);
  }

  captureError(error: Error, context?: Record<string, unknown>): void {
    captureErrorEvent(this.config, error, context);
  }

  captureMessage(message: string, severity?: "error" | "warning" | "info", context?: Record<string, unknown>): void {
    captureMessageEvent(this.config, message, severity, context);
  }

  getVisitorId(): string {
    return getVisitorId();
  }

  flush(): void {
    if (this.pendingPageViewTimer) {
      clearTimeout(this.pendingPageViewTimer);
      this.pendingPageViewTimer = null;
    }
    this.sendDuration();
  }

  destroy(): void {
    if (this.pendingPageViewTimer) {
      clearTimeout(this.pendingPageViewTimer);
      this.pendingPageViewTimer = null;
    }
    this.cleanupErrors?.();
    this.sendDuration();
  }

  // Private methods

  private sendDuration(): void {
    if (!this.currentPageViewId || this.pageViewStartTime === 0) return;

    const duration = Math.round((Date.now() - this.pageViewStartTime) / 1000);
    if (duration < 1 || duration > 3600) return;

    const url = `${this.config.apiUrl}/api/track/beacon?apiKey=${this.config.apiKey}`;
    sendBeacon(url, {
      pageViewId: this.currentPageViewId,
      duration,
    });

    this.currentPageViewId = null;
    this.pageViewStartTime = 0;
  }

  private getOriginalReferrer(): string {
    const sessionKey = "hm_original_referrer";
    const storedReferrer = sessionStorage.getItem(sessionKey);

    if (storedReferrer !== null) {
      return storedReferrer;
    }

    const docReferrer = document.referrer;
    let externalReferrer = "";
    try {
      if (docReferrer) {
        const referrerUrl = new URL(docReferrer);
        if (referrerUrl.hostname !== window.location.hostname) {
          externalReferrer = docReferrer;
        }
      }
    } catch {
      // Invalid URL, ignore
    }

    sessionStorage.setItem(sessionKey, externalReferrer);
    return externalReferrer;
  }

  private setupAutoPageViews(): void {
    // Prevent double setup (e.g. constructor called twice)
    if (this.autoPageViewsSetup) return;
    this.autoPageViewsSetup = true;

    // Track initial page view
    if (document.readyState === "complete") {
      this.trackPageView();
    } else {
      window.addEventListener("load", () => this.trackPageView());
    }

    // SPA navigation tracking
    const originalPushState = history.pushState;

    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      this.trackPageView();
    };

    window.addEventListener("popstate", () => {
      this.trackPageView();
    });

    // Send duration on visibility change / unload
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        this.sendDuration();
      }
    });

    window.addEventListener("beforeunload", () => {
      this.sendDuration();
    });
  }
}
