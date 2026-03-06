import axios, { type InternalAxiosRequestConfig } from 'axios'

export const DEFAULT_API_TIMEOUT_MS = 10000
export const LONG_API_TIMEOUT_MS = 30000
const MAX_API_RETRIES = 2
const API_RETRY_DELAY_MS = 750
const REQUEST_TIMEOUT_ERROR_MESSAGE =
  'Система отвечает слишком долго. Попробуйте ещё раз через несколько секунд.'
const TUNNEL_CONNECTION_ERROR_MESSAGE =
  'Соединение с мини-приложением временно прервалось. Попробуйте ещё раз через несколько секунд.'
const TRANSIENT_API_ERROR_MESSAGE =
  'Сервис временно недоступен. Попробуйте ещё раз через несколько секунд.'
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
const RENDER_BACKEND_API_URL = 'https://front-tg-backend.onrender.com/api'

const getApiBaseUrl = () => {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()

  if (configuredBaseUrl) {
    return configuredBaseUrl
  }

  if (typeof window === 'undefined') {
    return '/api'
  }

  const hostname = window.location.hostname.toLowerCase()

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return '/api'
  }

  if (hostname.endsWith('.onrender.com')) {
    return RENDER_BACKEND_API_URL
  }

  return '/api'
}

const apiBaseUrl = getApiBaseUrl()

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

const normalizeApiMessage = (message: string | null) => {
  if (!message) {
    return null
  }

  const normalizedMessage = message.trim()

  if (!normalizedMessage) {
    return null
  }

  return includesTunnelError(normalizedMessage)
    ? TUNNEL_CONNECTION_ERROR_MESSAGE
    : normalizedMessage
}

const extractPayloadMessage = (payload: unknown) => {
  if (typeof payload === 'string') {
    return normalizeApiMessage(payload)
  }

  if (!payload || typeof payload !== 'object') {
    return null
  }

  const maybeMessage =
    'error' in payload
      ? payload.error
      : 'message' in payload
        ? payload.message
        : 'warning' in payload
          ? payload.warning
          : null

  return typeof maybeMessage === 'string'
    ? normalizeApiMessage(maybeMessage)
    : null
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
      return REQUEST_TIMEOUT_ERROR_MESSAGE
    }

    const statusCode = error.response?.status

    if (
      statusCode === 530 ||
      (typeof error.message === 'string' &&
        includesTunnelError(error.message))
    ) {
      return TUNNEL_CONNECTION_ERROR_MESSAGE
    }

    if (
      typeof statusCode === 'number' &&
      TRANSIENT_API_STATUS_CODES.has(statusCode)
    ) {
      return TRANSIENT_API_ERROR_MESSAGE
    }

    const payloadMessage = extractPayloadMessage(error.response?.data)
    if (payloadMessage) {
      return payloadMessage
    }

    const errorMessage = normalizeApiMessage(error.message ?? null)
    if (errorMessage) {
      return errorMessage
    }
  }

  return fallback
}
