import axios from 'axios'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api'

export const apiClient = axios.create({
  baseURL: apiBaseUrl,
  timeout: 10000,
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
