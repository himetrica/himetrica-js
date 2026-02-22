import { useContext, useCallback, useState, useEffect } from "react";
import { HimetricaContext } from "./provider";
import type { HimetricaClient, VisitorInfo } from "../client";

export function useHimetrica(): HimetricaClient {
  const client = useContext(HimetricaContext);
  if (!client) {
    throw new Error("useHimetrica must be used within a HimetricaProvider");
  }
  return client;
}

export function useTrackEvent(): (
  eventName: string,
  properties?: Record<string, unknown>
) => void {
  const client = useHimetrica();
  return useCallback(
    (eventName: string, properties?: Record<string, unknown>) => {
      client.track(eventName, properties);
    },
    [client]
  );
}

export function useCaptureError(): (
  error: Error,
  context?: Record<string, unknown>
) => void {
  const client = useHimetrica();
  return useCallback(
    (error: Error, context?: Record<string, unknown>) => {
      client.captureError(error, context);
    },
    [client]
  );
}

const VISITOR_INFO_DEFAULTS = {
  isReturning: false,
  isIdentified: false,
  firstVisit: null as string | null,
  visitCount: 0,
  isLoading: true,
  error: null as string | null,
};

export function useVisitorInfo() {
  const client = useHimetrica();
  const [state, setState] = useState(VISITOR_INFO_DEFAULTS);

  useEffect(() => {
    let cancelled = false;

    client
      .getVisitorInfo()
      .then((info) => {
        if (cancelled) return;
        if (info) {
          setState({
            isReturning: info.isReturning,
            isIdentified: info.isIdentified,
            firstVisit: info.firstVisit,
            visitCount: info.visitCount,
            isLoading: false,
            error: null,
          });
        } else {
          setState({ ...VISITOR_INFO_DEFAULTS, isLoading: false });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          ...VISITOR_INFO_DEFAULTS,
          isLoading: false,
          error: err instanceof Error ? err.message : "Failed to fetch visitor info",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  return state;
}
