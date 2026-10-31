"use client";

import { Component, type ReactNode } from "react";

interface Props {
  /** Rendered instead of the children after a render error. */
  fallback: (error: unknown, reset: () => void) => ReactNode;
  /** Changing this value clears the error (e.g. the pathname). */
  resetKey?: unknown;
  children: ReactNode;
}

interface State {
  error: unknown;
  resetKey: unknown;
}

/** Catches errors thrown by Convex queries during render. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error !== null) return this.props.fallback(this.state.error, this.reset);
    return this.props.children;
  }
}
