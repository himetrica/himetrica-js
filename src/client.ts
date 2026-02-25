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
  __himetricaOriginalPushState?: typeof history.pushState;
  __himetricaOriginalReplaceState?: typeof history.replaceState;
  __himetricaPopstateListener?: ((e: PopStateEvent) => void) | null;
}

export class HimetricaClient {
  private config!: ResolvedConfig;
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
  private destroyed = false;
  private visitorInfoCache: VisitorInfo | null = null;
  private visitorInfoPromise: Promise<VisitorInfo | null> | null = null;

  // Bound listener references for proper removal
  private pageViewListener: ((path: string) => void) | null = null;
  private visibilityListener: (() => void) | null = null;
  private beforeUnloadListener: (() => void) | null = null;
  private loadListener: (() => void) | null = null;

  // init — constructor NEVER throws; invalid config disables the tracker
  constructor(userConfig: HimetricaConfig) {
    try {
      this.config = resolveConfig(userConfig);
    } catch (e) {
      if (typeof console !== "undefined") {
        console.warn("[Himetrica]", e instanceof Error ? e.message : e);
      }
      this.disabled = true;
      // Provide a minimal config so methods don't crash on property access
      this.config = {
        apiKey: "",
        apiUrl: "",
        autoTrackPageViews: false,
        autoTrackErrors: false,
        interceptConsole: false,
        trackVitals: false,
        respectDoNotTrack: true,
        sessionTimeout: 1800000,
      };
      return;
    }

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

    // Respect Do Not Track / Global Privacy Control
    if (this.config.respectDoNotTrack) {
      const dnt = navigator.doNotTrack === "1";
      const gpc = !!(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
      if (dnt || gpc) {
        return;
      }
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
    if (!isBrowser || this.disabled || this.destroyed) return;

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
    if (!isBrowser || this.disabled || this.destroyed) return;

    if (!eventName || typeof eventName !== "string") return;
    if (eventName.length > 255) return;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(eventName)) return;

    // Flush any pending page view so the server creates the session with full
    // device info before the custom event arrives. Without this, a fast
    // track() call can reach the server before the debounced pageview,
    // causing the event worker to create a bare session with 0 page views.
    this.flushPendingPageView();

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
    if (!isBrowser || this.disabled || this.destroyed) return;

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
    if (this.disabled || this.destroyed) return;
    captureErrorEvent(this.config, error, context);
  }

  captureMessage(message: string, severity?: "error" | "warning" | "info", context?: Record<string, unknown>): void {
    if (this.disabled || this.destroyed) return;
    captureMessageEvent(this.config, message, severity, context);
  }

  getVisitorId(): string {
    return getVisitorId(this.config.cookieDomain);
  }

  async getVisitorInfo(): Promise<VisitorInfo | null> {
    if (!isBrowser || this.disabled || this.destroyed) return null;
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
    if (this.destroyed) return;
    this.flushPendingPageView();
    this.sendDuration();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.flushPendingPageView();
    this.cleanupErrors?.();
    this.cleanupErrors = null;
    this.sendDuration();

    if (isBrowser) {
      const w = window as HimetricaWindow;

      // Remove this instance's page view listener from the global array
      if (this.pageViewListener && w.__himetricaPageViewListeners) {
        const idx = w.__himetricaPageViewListeners.indexOf(this.pageViewListener);
        if (idx !== -1) w.__himetricaPageViewListeners.splice(idx, 1);

        // If no more listeners, restore original history methods and clean up popstate
        if (w.__himetricaPageViewListeners.length === 0) {
          if (w.__himetricaOriginalPushState) {
            history.pushState = w.__himetricaOriginalPushState;
          }
          if (w.__himetricaOriginalReplaceState) {
            history.replaceState = w.__himetricaOriginalReplaceState;
          }
          if (w.__himetricaPopstateListener) {
            window.removeEventListener("popstate", w.__himetricaPopstateListener);
            w.__himetricaPopstateListener = null;
          }
          w.__himetricaPushStatePatched = false;
          w.__himetricaPageViewListeners = undefined;
          w.__himetricaOriginalPushState = undefined;
          w.__himetricaOriginalReplaceState = undefined;
        }
      }

      // Remove event listeners
      if (this.visibilityListener) {
        document.removeEventListener("visibilitychange", this.visibilityListener);
        this.visibilityListener = null;
      }
      if (this.beforeUnloadListener) {
        window.removeEventListener("beforeunload", this.beforeUnloadListener);
        this.beforeUnloadListener = null;
      }
      if (this.loadListener) {
        window.removeEventListener("load", this.loadListener);
        this.loadListener = null;
      }

      // Reset global flag so a new instance can be created (e.g., Provider remount)
      w.__himetricaInitialized = false;
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
    try {
      return this._getOriginalReferrerUnsafe();
    } catch {
      return "";
    }
  }

  private _getOriginalReferrerUnsafe(): string {
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
          if (refHost !== window.location.hostname && refHost !== root && !refHost.endsWith("." + root)) {
            externalReferrer = docReferrer;
          }
        }
      } catch {
        // Invalid URL, ignore
      }

      let cookie = `hm_ref=${encodeURIComponent(externalReferrer)}; path=/; SameSite=Lax; domain=${this.config.cookieDomain}`;
      if (location.protocol === "https:") {
        cookie += "; Secure";
      }
      document.cookie = cookie;
      return externalReferrer;
    }

    // sessionStorage mode — wrapped in safe accessors via visitor.ts
    const sessionKey = "hm_original_referrer";
    let storedReferrer: string | null = null;
    try { storedReferrer = sessionStorage.getItem(sessionKey); } catch { /* storage blocked */ }

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

    try { sessionStorage.setItem(sessionKey, externalReferrer); } catch { /* storage blocked */ }
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
      this.loadListener = () => this.trackPageView();
      window.addEventListener("load", this.loadListener);
    }

    // SPA navigation: use a single global pushState patch with listener pattern
    // This prevents chained wrapping when multiple instances exist
    if (!w.__himetricaPushStatePatched) {
      w.__himetricaPushStatePatched = true;
      w.__himetricaPageViewListeners = [];

      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;

      // Store originals for restoration on destroy
      w.__himetricaOriginalPushState = originalPushState;
      w.__himetricaOriginalReplaceState = originalReplaceState;

      history.pushState = function (...args) {
        originalPushState.apply(this, args);
        const listeners = (window as HimetricaWindow).__himetricaPageViewListeners;
        if (listeners) {
          for (const listener of listeners) {
            try { listener(window.location.pathname); } catch { /* isolate listener errors */ }
          }
        }
      };

      history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        const listeners = (window as HimetricaWindow).__himetricaPageViewListeners;
        if (listeners) {
          for (const listener of listeners) {
            try { listener(window.location.pathname); } catch { /* isolate listener errors */ }
          }
        }
      };

      // Store the popstate listener reference for cleanup
      const popstateListener = () => {
        const listeners = (window as HimetricaWindow).__himetricaPageViewListeners;
        if (listeners) {
          for (const listener of listeners) {
            try { listener(window.location.pathname); } catch { /* isolate listener errors */ }
          }
        }
      };
      w.__himetricaPopstateListener = popstateListener;
      window.addEventListener("popstate", popstateListener);
    }

    // Register this instance's trackPageView as a listener (store reference for cleanup)
    this.pageViewListener = () => this.trackPageView();
    w.__himetricaPageViewListeners!.push(this.pageViewListener);

    // Send duration when page becomes hidden or unloads.
    // NOTE: We intentionally do NOT flush pending pageviews here.
    // If the user navigates away before the debounce timer fires (800ms/3s),
    // the pageview is dropped — this correctly filters out redirect chain pages
    // that the user never actually viewed.
    this.visibilityListener = () => {
      if (document.visibilityState === "hidden") {
        this.sendDuration();
      }
    };
    document.addEventListener("visibilitychange", this.visibilityListener);

    this.beforeUnloadListener = () => {
      this.sendDuration();
    };
    window.addEventListener("beforeunload", this.beforeUnloadListener);
  }
}
