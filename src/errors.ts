import type { ResolvedConfig } from "./config";
import { getVisitorId, getSessionId } from "./visitor";
import { sendBeacon } from "./transport";

interface ErrorPayload {
  visitorId: string;
  sessionId: string;
  type: "error" | "unhandledrejection" | "console";
  message: string;
  stack?: string;
  source?: string;
  lineno?: number;
  colno?: number;
  severity: "error" | "warning" | "info";
  path: string;
  userAgent: string;
  timestamp: number;
  context?: Record<string, unknown>;
}

// Rate limiting
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 60 * 1000;
const errorTimestamps: number[] = [];

// Deduplication
const sentErrorHashes = new Set<string>();
const DEDUP_EXPIRY = 5 * 60 * 1000;

function hashError(
  message: string,
  stack?: string,
  source?: string,
  lineno?: number
): string {
  const str = `${message}|${stack ?? ""}|${source ?? ""}|${lineno ?? 0}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

function isRateLimited(): boolean {
  const now = Date.now();
  while (errorTimestamps.length > 0 && errorTimestamps[0] < now - RATE_LIMIT_WINDOW) {
    errorTimestamps.shift();
  }
  if (errorTimestamps.length >= RATE_LIMIT_MAX) {
    return true;
  }
  errorTimestamps.push(now);
  return false;
}

function isDuplicate(hash: string): boolean {
  if (sentErrorHashes.has(hash)) {
    return true;
  }
  sentErrorHashes.add(hash);
  setTimeout(() => sentErrorHashes.delete(hash), DEDUP_EXPIRY);
  return false;
}

function normalizeStack(stack?: string): string | undefined {
  if (!stack) return undefined;
  return stack.split("\n").slice(0, 20).join("\n");
}

function sendError(config: ResolvedConfig, payload: ErrorPayload): void {
  const url = `${config.apiUrl}/api/track/errors?apiKey=${config.apiKey}`;
  sendBeacon(url, payload);
}

export function captureErrorEvent(
  config: ResolvedConfig,
  error: Error | string,
  context?: Record<string, unknown>,
  type: "error" | "unhandledrejection" | "console" = "error",
  severity: "error" | "warning" | "info" = "error",
  source?: string,
  lineno?: number,
  colno?: number
): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? normalizeStack(error.stack) : undefined;
  const hash = hashError(message, stack, source, lineno);

  if (isRateLimited()) return;
  if (isDuplicate(hash)) return;

  const payload: ErrorPayload = {
    visitorId: getVisitorId(),
    sessionId: getSessionId(config.sessionTimeout),
    type,
    message,
    stack,
    source,
    lineno,
    colno,
    severity,
    path: typeof window !== "undefined" ? window.location.pathname : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    timestamp: Date.now(),
    context,
  };

  sendError(config, payload);
}

export function captureMessageEvent(
  config: ResolvedConfig,
  message: string,
  severity: "error" | "warning" | "info" = "info",
  context?: Record<string, unknown>
): void {
  captureErrorEvent(config, message, context, "console", severity);
}

export function setupErrorHandlers(config: ResolvedConfig): () => void {
  if (typeof window === "undefined") return () => {};

  const handleWindowError = (
    event: string | Event,
    source?: string,
    lineno?: number,
    colno?: number,
    error?: Error
  ): void => {
    const message =
      error?.message || (typeof event === "string" ? event : "Unknown error");
    captureErrorEvent(config, error || message, undefined, "error", "error", source, lineno, colno);
  };

  const handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "Unhandled Promise rejection";
    const err = reason instanceof Error ? reason : new Error(message);
    captureErrorEvent(config, err, { reason: String(reason) }, "unhandledrejection", "error");
  };

  window.onerror = handleWindowError;
  window.addEventListener("unhandledrejection", handleUnhandledRejection);

  let originalError: typeof console.error | undefined;
  let originalWarn: typeof console.warn | undefined;

  if (config.interceptConsole) {
    originalError = console.error;
    originalWarn = console.warn;

    console.error = function (...args: unknown[]) {
      originalError!.apply(console, args);
      const msg = args
        .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
        .join(" ");
      captureErrorEvent(config, msg, { args }, "console", "error");
    };

    console.warn = function (...args: unknown[]) {
      originalWarn!.apply(console, args);
      const msg = args
        .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
        .join(" ");
      captureErrorEvent(config, msg, { args }, "console", "warning");
    };
  }

  // Return cleanup function
  return () => {
    window.onerror = null;
    window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    if (originalError) console.error = originalError;
    if (originalWarn) console.warn = originalWarn;
  };
}
