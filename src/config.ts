export interface HimetricaConfig {
  apiKey: string;
  apiUrl?: string;
  autoTrackPageViews?: boolean;
  autoTrackErrors?: boolean;
  interceptConsole?: boolean;
  trackVitals?: boolean;
  respectDoNotTrack?: boolean;
  sessionTimeout?: number;
  cookieDomain?: string;
}

export interface ResolvedConfig {
  apiKey: string;
  apiUrl: string;
  autoTrackPageViews: boolean;
  autoTrackErrors: boolean;
  interceptConsole: boolean;
  trackVitals: boolean;
  respectDoNotTrack: boolean;
  sessionTimeout: number;
  cookieDomain?: string;
}

export function resolveConfig(config: HimetricaConfig): ResolvedConfig {
  if (!config.apiKey || typeof config.apiKey !== "string") {
    throw new Error("[Himetrica] apiKey is required and must be a non-empty string");
  }

  const sessionTimeout = config.sessionTimeout ?? 30 * 60 * 1000;
  if (typeof sessionTimeout !== "number" || sessionTimeout < 60_000 || sessionTimeout > 86_400_000) {
    throw new Error("[Himetrica] sessionTimeout must be between 60000 (1min) and 86400000 (24h)");
  }

  return {
    apiKey: config.apiKey,
    apiUrl: config.apiUrl ?? "https://app.himetrica.com",
    autoTrackPageViews: config.autoTrackPageViews ?? true,
    autoTrackErrors: config.autoTrackErrors ?? true,
    interceptConsole: config.interceptConsole ?? false,
    trackVitals: config.trackVitals ?? false,
    respectDoNotTrack: config.respectDoNotTrack ?? true,
    sessionTimeout,
    cookieDomain: config.cookieDomain,
  };
}
