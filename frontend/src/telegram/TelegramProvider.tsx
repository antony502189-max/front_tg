import { type PropsWithChildren, useEffect } from 'react'
import WebApp from '@twa-dev/sdk'
import { useThemeStore } from '../store/themeStore'

export const TelegramProvider = ({ children }: PropsWithChildren) => {
  const setThemeFromTelegram = useThemeStore(
    (state) => state.setThemeFromTelegram,
  )

  useEffect(() => {
    WebApp.ready()

    setThemeFromTelegram(WebApp.themeParams, WebApp.colorScheme)

    const handleThemeChanged = () => {
      setThemeFromTelegram(WebApp.themeParams, WebApp.colorScheme)
    }

    WebApp.onEvent('themeChanged', handleThemeChanged)

    return () => {
      WebApp.offEvent('themeChanged', handleThemeChanged)
    }
  }, [setThemeFromTelegram])

  return children
}

