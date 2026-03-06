import {
  type PropsWithChildren,
  useEffect,
  useEffectEvent,
} from 'react'
import WebApp from '@twa-dev/sdk'
import { useThemeStore } from '../store/themeStore'

export const TelegramProvider = ({ children }: PropsWithChildren) => {
  const setThemeFromTelegram = useThemeStore(
    (state) => state.setThemeFromTelegram,
  )
  const syncTheme = useEffectEvent(() => {
    setThemeFromTelegram(WebApp.themeParams, WebApp.colorScheme)
  })

  useEffect(() => {
    WebApp.ready()
    syncTheme()

    const handleThemeChanged = () => {
      syncTheme()
    }

    WebApp.onEvent('themeChanged', handleThemeChanged)

    return () => {
      WebApp.offEvent('themeChanged', handleThemeChanged)
    }
  }, [setThemeFromTelegram])

  return children
}

