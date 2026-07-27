import { Component } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

// Every deploy ships route chunks under new content hashes and the old
// files are gone from the server the moment the new container is live.
// A tab left open across a deploy still holds the old index.html, so its
// next lazy `import()` 404s with this message. Auto-reload once (guarded
// via sessionStorage so a genuinely broken deploy doesn't reload-loop).
const CHUNK_ERROR_PATTERN =
  /fetch dynamically imported module|importing a module script failed/i
const CHUNK_RELOAD_KEY = 'yzyt:chunk-reload-attempted'

/**
 * Top-level error boundary. Catches any render-time throw so a single broken
 * page can't blank the whole app. Shows a friendly reload card with the
 * error message (the error itself is also logged to the console for devs).
 *
 * Use as: <ErrorBoundary>{children}</ErrorBoundary> at the App root.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidMount() {
    // Reached a working render, so this tab is on a live deploy again —
    // let a future stale-chunk error retry the auto-reload.
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(CHUNK_RELOAD_KEY)
    }
  }

  componentDidCatch(error, info) {
    // Surface the error to the dev console; in production this is the only
    // place future telemetry would hook in.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info?.componentStack)

    if (
      typeof window !== 'undefined' &&
      CHUNK_ERROR_PATTERN.test(error?.message ?? '') &&
      !window.sessionStorage.getItem(CHUNK_RELOAD_KEY)
    ) {
      window.sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
      window.location.reload()
    }
  }

  handleReload = () => {
    if (typeof window !== 'undefined') window.location.reload()
  }

  handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Bir şeyler ters gitti</CardTitle>
            <CardDescription>
              Bu ekran yüklenirken beklenmeyen bir hata oluştu. Aşağıdaki butonlarla
              deneyebilirsin.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-40 text-muted-foreground">
              {String(this.state.error?.message ?? this.state.error)}
            </pre>
            <div className="flex gap-2">
              <Button onClick={this.handleReset} variant="outline">
                Tekrar dene
              </Button>
              <Button onClick={this.handleReload}>Sayfayı yenile</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }
}
