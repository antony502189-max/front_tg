import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import WebApp from '@twa-dev/sdk'

type UseTelegramBackButtonOptions = {
  enabled?: boolean
  /**
   * Optional route to navigate to when back button is pressed.
   * If not provided, will navigate one step back in history.
   */
  to?: string
  /**
   * Custom click handler. If provided, it will be called instead of the
   * default navigation logic.
   */
  onClick?: () => void
}

export const useTelegramBackButton = (
  options: UseTelegramBackButtonOptions = {},
) => {
  const { enabled = true, to, onClick } = options
  const navigate = useNavigate()

  useEffect(() => {
    if (!enabled) {
      WebApp.BackButton.hide()
      return
    }

    WebApp.BackButton.show()

    const handler = () => {
      if (onClick) {
        onClick()
        return
      }

      if (to) {
        navigate(to)
      } else {
        navigate(-1)
      }
    }

    WebApp.BackButton.onClick(handler)

    return () => {
      WebApp.BackButton.offClick(handler)
      WebApp.BackButton.hide()
    }
  }, [enabled, navigate, onClick, to])
}

