import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { TelegramProvider } from './telegram/TelegramProvider'

const showFatalError = (message: string) => {
  const root = document.getElementById('root')

  if (!root) {
    return
  }

  root.innerHTML = `
    <div style="min-height:100vh;padding:16px;background:#fff;color:#111;font:14px/1.5 system-ui,sans-serif;">
      <h1 style="margin:0 0 12px;font-size:18px;">Mini App crashed</h1>
      <pre style="white-space:pre-wrap;word-break:break-word;margin:0;">${message}</pre>
    </div>
  `
}

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    showFatalError(
      `${error.message}\n\n${error.stack ?? ''}\n\n${errorInfo.componentStack}`,
    )
  }

  render() {
    if (this.state.hasError) {
      return null
    }

    return this.props.children
  }
}

window.addEventListener('error', (event) => {
  showFatalError(event.error?.stack ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason =
    event.reason instanceof Error
      ? event.reason.stack ?? event.reason.message
      : String(event.reason)

  showFatalError(reason)
})

try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RootErrorBoundary>
        <TelegramProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </TelegramProvider>
      </RootErrorBoundary>
    </StrictMode>,
  )
} catch (error) {
  showFatalError(error instanceof Error ? error.stack ?? error.message : String(error))
}
