// React error boundary. Wraps the app (catch-all) and each persona's route
// subtree (so a bug in /td/* doesn't take down /desk/*).
//
// In dev, errors also bubble to the console with full stack so the source-map
// reverse-lookup works. In production, the user sees a clean fallback and a
// "try again" button that resets the boundary.

import { Component } from 'react'
import { Link } from 'react-router-dom'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Surface to the console so the dev sees a real stack. In prod, this also
    // lights up any browser error reporters (Sentry, etc.) we may wire later.
    console.error('[ErrorBoundary]', error, info)
  }

  handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      const fallback = this.props.fallback
      if (fallback) {
        return typeof fallback === 'function'
          ? fallback({ error: this.state.error, reset: this.handleReset })
          : fallback
      }
      return <DefaultFallback error={this.state.error} onReset={this.handleReset} />
    }
    return this.props.children
  }
}

function DefaultFallback({ error, onReset }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="max-w-lg w-full bg-felt-800 border border-red-500/30 rounded-lg p-6">
        <h2 className="font-display text-2xl text-red-200 mb-3">Something broke.</h2>
        <p className="text-sm text-white/70 mb-1">
          The app caught an unexpected error and stopped rendering this section.
        </p>
        <pre className="bg-felt-950/80 text-red-200/80 text-xs font-mono p-3 my-4 rounded overflow-x-auto whitespace-pre-wrap">
          {error?.message ?? String(error)}
        </pre>
        <p className="text-xs text-white/40 mb-4">
          If this keeps happening, take a screenshot, note what you were doing, and let the floor manager know.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onReset}
            className="px-4 py-2 rounded-lg bg-gold-500/15 text-gold-300 hover:bg-gold-500/25 text-sm"
          >
            Try again
          </button>
          <Link
            to="/"
            onClick={onReset}
            className="px-4 py-2 rounded-lg bg-white/5 text-white/70 hover:bg-white/10 text-sm"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  )
}
