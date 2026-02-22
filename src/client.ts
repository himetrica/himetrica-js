import { type HimetricaConfig, type ResolvedConfig, resolveConfig } from "./config";
import { sendPost, sendBeacon } from "./transport";
import { getVisitorId, setVisitorId, getSessionId, generatePageViewId, getSessionUtmParams } from "./visitor";
import { captureErrorEvent, captureMessageEvent, setupErrorHandlers } from "./errors";
import { setupVitals } from "./vitals";

const isBrowser = typeof window !== "undefined";

export interface VisitorInfo {
  isReturning: boolean;
  isIdentified: boolean;
  firstVisit: string | null;
  visitCount: number;
}

interface HimetricaWindow extends Window {
  __himetricaInitialized?: boolean;
  __himetricaPushStatePatched?: boolean;
  __himetricaPageViewListeners?: Array<(path: string) => void>;
}

export class HimetricaClient {
  private config: ResolvedConfig;
  private currentPageViewId: string | null = null;
  private pageViewStartTime = 0;
  private lastTrackedPath: string | null = null;
  private autoPageViewsSetup = false;
  private pendingPageViewTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPageViewData: Record<string, unknown> | null = null;
  private isFirstPageView = true;
  private static readonly FIRST_PAGE_VIEW_DELAY = 300; // 300ms - catches redirects
  private static readonly PAGE_VIEW_MIN_DURATION = 1000; // 1 second
  private cleanupErrors: (() => void) | null = null;
  private disabled = false;
  private visitorInfoCache: VisitorInfo | null = null;
  private visitorInfoPromise: Promise<VisitorInfo | null> | null = null;
  // init
  constructor(userConfig: HimetricaConfig) {
    this.config = resolveConfig(userConfig);

    if (!isBrowser) return;

    // Don't track inside iframes — prevents double-counting when parent page also has the tracker
    try {
      if (window.self !== window.top) {
        this.disabled = true;
        return;
      }
    } catch {
      // Sandboxed iframe — window.top access throws SecurityError
      this.disabled = true;
      return;
    }

    // Don't track on localhost
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      this.disabled = true;
      return;
    }

    // Prevent multiple tracker instances (same guard as standalone tracker.js)
    const w = window as HimetricaWindow;
    if (w.__himetricaInitialized) return;
    w.__himetricaInitialized = true;

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
    if (!isBrowser || this.disabled) return;

    const currentPath = path ?? (window.location.pathname + window.location.search);

    // Skip duplicate: same path already tracked
    if (currentPath === this.lastTrackedPath) return;
    this.lastTrackedPath = currentPath;

    // Cancel any pending pageview that didn't meet the minimum duration
    if (this.pendingPageViewTimer) {
      clearTimeout(this.pendingPageViewTimer);
      this.pendingPageViewTimer = null;
      this.pendingPageViewData = null;
    }

    // Send duration for previous page view
    this.sendDuration();

    this.currentPageViewId = generatePageViewId();
    this.pageViewStartTime = Date.now();

    // Resolve UTM params: URL first, then cookie fallback (cross-subdomain persistence)
    const utmParams = getSessionUtmParams(this.config.cookieDomain);

    const data: Record<string, unknown> = {
      visitorId: getVisitorId(this.config.cookieDomain),
      sessionId: getSessionId(this.config.sessionTimeout, this.config.cookieDomain),
      pageViewId: this.currentPageViewId,
      path: path ?? window.location.pathname,
      title: document.title,
      referrer: this.getOriginalReferrer(),
      queryString: window.location.search,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
    };

    // Include resolved UTM params so server doesn't rely solely on queryString
    if (utmParams) {
      data.utmParams = {
        utm_source: utmParams.s,
        utm_medium: utmParams.m,
        utm_campaign: utmParams.c,
        utm_term: utmParams.t,
        utm_content: utmParams.n,
      };
    }

    // First pageview uses short delay to catch redirect chains;
    // subsequent ones use longer delay to ensure user actually viewed the page
    const delay = this.isFirstPageView
      ? HimetricaClient.FIRST_PAGE_VIEW_DELAY
      : HimetricaClient.PAGE_VIEW_MIN_DURATION;
    this.isFirstPageView = false;
    this.pendingPageViewData = data;

    this.pendingPageViewTimer = setTimeout(() => {
      this.pendingPageViewTimer = null;
      this.pendingPageViewData = null;
      // Read title at send time — frameworks (Next.js, React) update document.title
      // asynchronously after pushState/replaceState, so capturing it earlier
      // would return the previous page's title.
      data.title = document.title;
      sendPost(`${this.config.apiUrl}/api/track/event`, data, this.config.apiKey);
    }, delay);
  }

  track(eventName: string, properties?: Record<string, unknown>): void {
    if (!isBrowser || this.disabled) return;

    if (!eventName || typeof eventName !== "string") return;
    if (eventName.length > 255) return;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(eventName)) return;

    const data = {
      visitorId: getVisitorId(this.config.cookieDomain),
      sessionId: getSessionId(this.config.sessionTimeout, this.config.cookieDomain),
      eventName,
      properties,
      path: window.location.pathname,
      title: document.title,
      queryString: window.location.search,
    };

    sendPost(`${this.config.apiUrl}/api/track/custom-event`, data, this.config.apiKey);
  }

  identify(data: { name?: string; email?: string; metadata?: Record<string, unknown> }): void {
    if (!isBrowser || this.disabled) return;

    const currentVisitorId = getVisitorId(this.config.cookieDomain);
    const payload = {
      visitorId: currentVisitorId,
      name: data.name,
      email: data.email,
      metadata: data.metadata,
    };

    const cookieDomain = this.config.cookieDomain;
    fetch(`${this.config.apiUrl}/api/track/identify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.config.apiKey,
      },
      body: JSON.stringify(payload),
      keepalive: true,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        // Server returns canonical visitorId when a merge occurred —
        // update client storage so subsequent pageviews use the correct ID
        if (json?.visitorId && json.visitorId !== currentVisitorId) {
          setVisitorId(json.visitorId, cookieDomain);
        }
      })
      .catch(() => {
        // Silently fail
      });
  }

  captureError(error: Error, context?: Record<string, unknown>): void {
    if (this.disabled) return;
    captureErrorEvent(this.config, error, context);
  }

  captureMessage(message: string, severity?: "error" | "warning" | "info", context?: Record<string, unknown>): void {
    if (this.disabled) return;
    captureMessageEvent(this.config, message, severity, context);
  }

  getVisitorId(): string {
    return getVisitorId(this.config.cookieDomain);
  }

  async getVisitorInfo(): Promise<VisitorInfo | null> {
    if (!isBrowser || this.disabled) return null;
    if (this.visitorInfoCache) return this.visitorInfoCache;
    if (this.visitorInfoPromise) return this.visitorInfoPromise;
    this.visitorInfoPromise = this.fetchVisitorInfo();
    return this.visitorInfoPromise;
  }

  private async fetchVisitorInfo(): Promise<VisitorInfo | null> {
    try {
      const visitorId = getVisitorId(this.config.cookieDomain);
      const url = `${this.config.apiUrl}/api/track/visitor-info?apiKey=${encodeURIComponent(this.config.apiKey)}&visitorId=${encodeURIComponent(visitorId)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data: VisitorInfo = await res.json();
      this.visitorInfoCache = data;
      return data;
    } catch {
      return null;
    } finally {
      this.visitorInfoPromise = null;
    }
  }

  flush(): void {
    this.flushPendingPageView();
    this.sendDuration();
  }

  destroy(): void {
    this.flushPendingPageView();
    this.cleanupErrors?.();
    this.sendDuration();

    // Reset global flag so a new instance can be created (e.g., Provider remount)
    if (isBrowser) {
      (window as HimetricaWindow).__himetricaInitialized = false;
    }
  }

  private flushPendingPageView(): void {
    if (this.pendingPageViewTimer) {
      clearTimeout(this.pendingPageViewTimer);
      this.pendingPageViewTimer = null;
    }
    if (this.pendingPageViewData) {
      this.pendingPageViewData.title = document.title;
      sendPost(`${this.config.apiUrl}/api/track/event`, this.pendingPageViewData, this.config.apiKey);
      this.pendingPageViewData = null;
    }
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
    if (this.config.cookieDomain) {
      // Cookie mode: use hm_ref cookie shared across subdomains
      const match = document.cookie.match(/(?:^|; )hm_ref=([^;]*)/);
      const storedReferrer = match ? decodeURIComponent(match[1]) : null;

      if (storedReferrer !== null) {
        return storedReferrer;
      }

      const docReferrer = document.referrer;
      let externalReferrer = "";
      try {
        if (docReferrer) {
          const referrerUrl = new URL(docReferrer);
          const refHost = referrerUrl.hostname;
          const cd = this.config.cookieDomain!;
          const root = cd.startsWith(".") ? cd.slice(1) : cd;
          // Treat sibling subdomains as internal when cookie domain is set
          if (refHost !== window.location.hostname && refHost !== root && !refHost.endsWith("." + root)) {
            externalReferrer = docReferrer;
          }
        }
      } catch {
        // Invalid URL, ignore
      }

      // Set as session cookie
      let cookie = `hm_ref=${encodeURIComponent(externalReferrer)}; path=/; SameSite=Lax; domain=${this.config.cookieDomain}`;
      if (location.protocol === "https:") {
        cookie += "; Secure";
      }
      document.cookie = cookie;
      return externalReferrer;
    }

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

    const w = window as HimetricaWindow;

    // Track initial page view
    if (document.readyState === "complete") {
      this.trackPageView();
    } else {
      window.addEventListener("load", () => this.trackPageView());
    }

    // SPA navigation: use a single global pushState patch with listener pattern
    // This prevents chained wrapping when multiple instances exist
    if (!w.__himetricaPushStatePatched) {
      w.__himetricaPushStatePatched = true;
      w.__himetricaPageViewListeners = [];

      const originalPushState = history.pushState;
      history.pushState = function (...args) {
        originalPushState.apply(this, args);
        const listeners = (window as HimetricaWindow).__himetricaPageViewListeners;
        if (listeners) {
          for (const listener of listeners) {
            listener(window.location.pathname);
          }
        }
      };

      const originalReplaceState = history.replaceState;
      history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        const listeners = (window as HimetricaWindow).__himetricaPageViewListeners;
        if (listeners) {
          for (const listener of listeners) {
            listener(window.location.pathname);
          }
        }
      };

      window.addEventListener("popstate", () => {
        const listeners = w.__himetricaPageViewListeners;
        if (listeners) {
          for (const listener of listeners) {
            listener(window.location.pathname);
          }
        }
      });
    }

    // Register this instance's trackPageView as a listener
    w.__himetricaPageViewListeners!.push(() => this.trackPageView());

    // Send duration when page becomes hidden or unloads.
    // NOTE: We intentionally do NOT flush pending pageviews here.
    // If the user navigates away before the debounce timer fires (800ms/3s),
    // the pageview is dropped — this correctly filters out redirect chain pages
    // that the user never actually viewed.
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
