import { Component } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

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

  componentDidCatch(error, info) {
    // Surface the error to the dev console; in production this is the only
    // place future telemetry would hook in.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info?.componentStack)
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
