import axios from 'axios'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api'
export const DEFAULT_API_TIMEOUT_MS = 10000
export const LONG_API_TIMEOUT_MS = 30000

export const apiClient = axios.create({
  baseURL: apiBaseUrl,
  timeout: DEFAULT_API_TIMEOUT_MS,
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (import.meta.env.DEV) {
      console.error('[API error]', error)
    }

    return Promise.reject(error)
  },
)

export const getApiErrorMessage = (
  error: unknown,
  fallback: string,
): string => {
  if (axios.isAxiosError(error)) {
    if (
      error.code === 'ECONNABORTED' ||
      error.message?.toLowerCase().includes('timeout')
    ) {
      return 'Система отвечает слишком долго. Попробуйте ещё раз через несколько секунд.'
    }

    const payload = error.response?.data

    if (typeof payload === 'string' && payload.trim()) {
      return payload.trim()
    }

    if (payload && typeof payload === 'object') {
      const maybeMessage =
        'error' in payload
          ? payload.error
          : 'message' in payload
            ? payload.message
            : 'warning' in payload
              ? payload.warning
              : null

      if (
        typeof maybeMessage === 'string' &&
        maybeMessage.trim()
      ) {
        return maybeMessage.trim()
      }
    }

    if (typeof error.message === 'string' && error.message.trim()) {
      return error.message.trim()
    }
  }

  return fallback
}
