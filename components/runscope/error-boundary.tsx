"use client"

import { Component, type ReactNode } from "react"
import { TriangleAlert } from "lucide-react"

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("[octane] render error:", error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
          <div className="w-full max-w-md rounded-xl border border-border bg-card/60 p-6 text-center">
            <span className="mx-auto mb-3 inline-flex size-12 items-center justify-center rounded-2xl bg-destructive/15 text-destructive">
              <TriangleAlert className="size-6" />
            </span>
            <h2 className="text-base font-semibold text-foreground">Something went wrong</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The view hit an unexpected error. Reloading usually fixes it.
            </p>
            <pre className="mt-3 max-h-32 overflow-auto rounded-md border border-border bg-background/60 p-2 text-left font-mono text-[11px] text-muted-foreground">
              {this.state.error.message}
            </pre>
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => this.setState({ error: null })}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
