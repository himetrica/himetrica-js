# @himetrica/tracker-js

A lightweight, privacy-focused analytics SDK for web applications. Supports vanilla JavaScript, React, and any framework with ES module or CommonJS imports.

## Features

- **Page view tracking** - Automatic SPA-aware page view tracking
- **Custom events** - Track user actions with custom properties
- **User identification** - Associate analytics with user profiles
- **Error tracking** - Capture errors, unhandled rejections, and console errors
- **Web Vitals** - Track Core Web Vitals (LCP, CLS, INP, FCP, TTFB)
- **Session management** - Automatic session handling with configurable timeout
- **SSR-safe** - All browser APIs guarded for server-side rendering
- **Privacy-first** - Respects Do Not Track by default
- **Dual format** - Ships ESM and CJS with full TypeScript declarations
- **React integration** - Provider, ErrorBoundary, and hooks included

## Installation

```bash
npm install @himetrica/tracker-js
```

```bash
yarn add @himetrica/tracker-js
```

```bash
pnpm add @himetrica/tracker-js
```

## Quick Start

### Vanilla JavaScript / TypeScript

```typescript
import { HimetricaClient } from "@himetrica/tracker-js";

const hm = new HimetricaClient({
  apiKey: "your-api-key",
});

// Track a custom event
hm.track("signup_completed", { plan: "pro" });

// Identify a user
hm.identify({
  name: "Jane Doe",
  email: "jane@example.com",
  metadata: { plan: "pro" },
});

// Capture an error manually
try {
  riskyOperation();
} catch (error) {
  hm.captureError(error as Error, { operation: "data_sync" });
}

// Capture a message
hm.captureMessage("Rate limit exceeded", "warning", { userId: "123" });
```

### React

```tsx
import { HimetricaProvider, HimetricaErrorBoundary } from "@himetrica/tracker-js/react";

function App() {
  return (
    <HimetricaProvider apiKey="your-api-key" autoTrackErrors>
      <HimetricaErrorBoundary fallback={<ErrorPage />}>
        <MainApp />
      </HimetricaErrorBoundary>
    </HimetricaProvider>
  );
}
```

#### Hooks

```tsx
import { useHimetrica, useTrackEvent, useCaptureError } from "@himetrica/tracker-js/react";

function CheckoutButton() {
  const trackEvent = useTrackEvent();

  return (
    <button onClick={() => trackEvent("checkout_started", { items: 3 })}>
      Checkout
    </button>
  );
}

function DataLoader() {
  const captureError = useCaptureError();

  useEffect(() => {
    fetchData().catch((err) => {
      captureError(err, { component: "DataLoader" });
    });
  }, []);

  return <div>...</div>;
}

function AdvancedUsage() {
  const hm = useHimetrica(); // Full client access

  hm.identify({ name: "Jane", email: "jane@example.com" });
  hm.track("page_interaction", { section: "hero" });
}
```

## Configuration

```typescript
const hm = new HimetricaClient({
  apiKey: "your-api-key",         // Required
  autoTrackPageViews: true,       // Auto-track page views and SPA navigation
  autoTrackErrors: true,          // Auto-capture uncaught errors and rejections
  interceptConsole: false,        // Capture console.error/warn as errors
  trackVitals: false,             // Track Core Web Vitals
  respectDoNotTrack: true,        // Respect browser Do Not Track setting
  sessionTimeout: 30 * 60 * 1000, // Session timeout in ms (default: 30 min)
});
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | required | Your Himetrica API key |
| `autoTrackPageViews` | `boolean` | `true` | Auto-track page views and SPA navigation |
| `autoTrackErrors` | `boolean` | `true` | Auto-capture uncaught errors and rejections |
| `interceptConsole` | `boolean` | `false` | Capture console.error/warn |
| `trackVitals` | `boolean` | `false` | Track Core Web Vitals |
| `respectDoNotTrack` | `boolean` | `true` | Respect Do Not Track |
| `sessionTimeout` | `number` | `1800000` (30 min) | Session timeout in ms |

## API Reference

### HimetricaClient

| Method | Description |
|--------|-------------|
| `trackPageView(path?)` | Track a page view (optional custom path) |
| `track(eventName, properties?)` | Track a custom event |
| `identify({ name?, email?, metadata? })` | Identify the current user |
| `captureError(error, context?)` | Capture an error |
| `captureMessage(message, severity?, context?)` | Capture a message |
| `getVisitorId()` | Get the current visitor ID |
| `flush()` | Send any pending duration beacons |
| `destroy()` | Clean up handlers and flush |

### React Exports (`@himetrica/tracker-js/react`)

| Export | Description |
|--------|-------------|
| `HimetricaProvider` | Context provider, accepts all config props |
| `HimetricaErrorBoundary` | Error boundary that reports to Himetrica |
| `useHimetrica()` | Access the client instance |
| `useTrackEvent()` | Returns a `track()` function |
| `useCaptureError()` | Returns a `captureError()` function |

## Features

### Automatic Page View Tracking

When `autoTrackPageViews` is enabled, the SDK automatically tracks:
- Initial page load
- SPA navigation via `history.pushState` and `history.replaceState`
- Browser back/forward navigation (`popstate`)
- Page duration (sent on visibility change or page unload)

### Error Tracking

When `autoTrackErrors` is enabled, the SDK captures:
- Uncaught exceptions (`window.onerror`)
- Unhandled promise rejections (`unhandledrejection`)
- Optionally, `console.error` and `console.warn` (with `interceptConsole: true`)

Errors are rate-limited (max 10/minute) and deduplicated (5-minute window) to avoid flooding.

### Web Vitals

When `trackVitals` is enabled, the SDK reports Core Web Vitals:
- **TTFB** - Time to First Byte
- **FCP** - First Contentful Paint
- **LCP** - Largest Contentful Paint
- **CLS** - Cumulative Layout Shift
- **INP** - Interaction to Next Paint

### Session Management

Sessions expire after 30 minutes of inactivity (configurable). A new session ID is generated when the timeout elapses. Visitor IDs persist across sessions in `localStorage`.

### SSR Safety

All browser APIs are guarded with `typeof window !== "undefined"` checks. The client can be safely instantiated in server-side environments (Next.js, Remix, etc.) without errors.

## Privacy

- **Do Not Track**: Respects the browser's DNT setting by default. Disable with `respectDoNotTrack: false`.
- **Referrer tracking**: Only captures external referrers (different domain), once per session.
- **No cookies**: Uses `localStorage` and `sessionStorage` only.

## License

MIT License
