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
  return {
    apiKey: config.apiKey,
    apiUrl: config.apiUrl ?? "https://app.himetrica.com",
    autoTrackPageViews: config.autoTrackPageViews ?? true,
    autoTrackErrors: config.autoTrackErrors ?? true,
    interceptConsole: config.interceptConsole ?? false,
    trackVitals: config.trackVitals ?? false,
    respectDoNotTrack: config.respectDoNotTrack ?? true,
    sessionTimeout: config.sessionTimeout ?? 30 * 60 * 1000,
    cookieDomain: config.cookieDomain,
  };
}
