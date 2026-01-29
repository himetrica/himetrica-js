import React, { Component } from "react";
import type { HimetricaClient } from "../client";
import { HimetricaContext } from "./provider";

interface HimetricaErrorBoundaryProps {
  children: React.ReactNode;
  fallback: React.ReactNode;
}

interface HimetricaErrorBoundaryState {
  hasError: boolean;
}

export class HimetricaErrorBoundary extends Component<
  HimetricaErrorBoundaryProps,
  HimetricaErrorBoundaryState
> {
  static contextType = HimetricaContext;
  declare context: HimetricaClient | null;

  constructor(props: HimetricaErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): HimetricaErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.context?.captureError(error, {
      componentStack: errorInfo.componentStack ?? undefined,
    });
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}
