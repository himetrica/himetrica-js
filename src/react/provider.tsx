import React, { createContext, useEffect, useRef } from "react";
import { HimetricaClient } from "../client";
import type { HimetricaConfig } from "../config";

export const HimetricaContext = createContext<HimetricaClient | null>(null);

export interface HimetricaProviderProps extends HimetricaConfig {
  children: React.ReactNode;
}

export function HimetricaProvider({
  children,
  ...config
}: HimetricaProviderProps) {
  const clientRef = useRef<HimetricaClient | null>(null);

  if (!clientRef.current) {
    clientRef.current = new HimetricaClient(config);
  }

  useEffect(() => {
    return () => {
      clientRef.current?.destroy();
    };
  }, []);

  return (
    <HimetricaContext.Provider value={clientRef.current}>
      {children}
    </HimetricaContext.Provider>
  );
}
