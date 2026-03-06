import axios, { type InternalAxiosRequestConfig } from 'axios'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api'
export const DEFAULT_API_TIMEOUT_MS = 10000
export const LONG_API_TIMEOUT_MS = 30000
const MAX_API_RETRIES = 2
const API_RETRY_DELAY_MS = 750
const TRANSIENT_API_STATUS_CODES = new Set([
  502,
  503,
  504,
  520,
  522,
  524,
  530,
])
const TUNNEL_ERROR_PATTERNS = [
  'argo tunnel',
  'origin has been unregistered',
  'trycloudflare',
]

type RetriableRequestConfig = InternalAxiosRequestConfig & {
  retryCount?: number
}

export const apiClient = axios.create({
  baseURL: apiBaseUrl,
  timeout: DEFAULT_API_TIMEOUT_MS,
})

const pause = (delayMs: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })

const includesTunnelError = (value: string) => {
  const normalizedValue = value.toLowerCase()

  return TUNNEL_ERROR_PATTERNS.some((pattern) =>
    normalizedValue.includes(pattern),
  )
}

const shouldRetryApiError = (error: unknown) => {
  if (!axios.isAxiosError(error)) {
    return false
  }

  const statusCode = error.response?.status

  if (
    typeof statusCode === 'number' &&
    TRANSIENT_API_STATUS_CODES.has(statusCode)
  ) {
    return true
  }

  if (
    typeof error.message === 'string' &&
    includesTunnelError(error.message)
  ) {
    return true
  }

  return !error.response && error.code !== 'ERR_CANCELED'
}

const canRetryRequest = (
  config: RetriableRequestConfig | undefined,
) => {
  const method = config?.method?.toLowerCase()

  return !!config && (!method || method === 'get')
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (axios.isAxiosError(error)) {
      const config = error.config as
        | RetriableRequestConfig
        | undefined
      const retryCount = config?.retryCount ?? 0

      if (
        config &&
        canRetryRequest(config) &&
        shouldRetryApiError(error) &&
        retryCount < MAX_API_RETRIES
      ) {
        const nextRetryCount = retryCount + 1
        config.retryCount = nextRetryCount
        await pause(API_RETRY_DELAY_MS * nextRetryCount)

        return apiClient.request(config)
      }
    }

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

    const statusCode = error.response?.status

    if (
      statusCode === 530 ||
      (typeof error.message === 'string' &&
        includesTunnelError(error.message))
    ) {
      return 'Соединение с мини-приложением временно прервалось. Попробуйте ещё раз через несколько секунд.'
    }

    if (
      typeof statusCode === 'number' &&
      TRANSIENT_API_STATUS_CODES.has(statusCode)
    ) {
      return 'Сервис временно недоступен. Попробуйте ещё раз через несколько секунд.'
    }

    const payload = error.response?.data

    if (typeof payload === 'string' && payload.trim()) {
      if (includesTunnelError(payload)) {
        return 'Соединение с мини-приложением временно прервалось. Попробуйте ещё раз через несколько секунд.'
      }

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
        if (includesTunnelError(maybeMessage)) {
          return 'Соединение с мини-приложением временно прервалось. Попробуйте ещё раз через несколько секунд.'
        }

        return maybeMessage.trim()
      }
    }

    if (typeof error.message === 'string' && error.message.trim()) {
      return error.message.trim()
    }
  }

  return fallback
}
