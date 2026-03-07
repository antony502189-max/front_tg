import axios, {
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios'

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
const RENDER_BACKEND_API_URLS: Record<string, string> = {
  'frontend-tg.onrender.com': 'https://backend-tg-u57f.onrender.com/api',
}
const MAX_RESPONSE_CACHE_ENTRIES = 200
const responseCache = new Map<
  string,
  {
    expiresAt: number
    data: unknown
  }
>()
const inflightRequests = new Map<string, Promise<unknown>>()

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

  const renderApiBaseUrl = RENDER_BACKEND_API_URLS[hostname]
  if (renderApiBaseUrl) {
    return renderApiBaseUrl
  }

  return '/api'
}

const apiBaseUrl = getApiBaseUrl()

const buildRequestCacheKey = (
  url: string,
  params?: AxiosRequestConfig['params'],
) => {
  const normalizedParams =
    params &&
    typeof params === 'object' &&
    !Array.isArray(params)
      ? new URLSearchParams(
          Object.entries(params as Record<string, unknown>)
            .sort(([leftKey], [rightKey]) =>
              leftKey.localeCompare(rightKey),
            )
            .filter(([, value]) => value != null)
            .map(([key, value]) => [key, String(value)]),
        ).toString()
      : ''

  return normalizedParams ? `${url}?${normalizedParams}` : url
}

const pruneResponseCache = (now: number) => {
  for (const [cacheKey, cacheEntry] of responseCache.entries()) {
    if (cacheEntry.expiresAt <= now) {
      responseCache.delete(cacheKey)
    }
  }

  if (responseCache.size <= MAX_RESPONSE_CACHE_ENTRIES) {
    return
  }

  for (const cacheKey of responseCache.keys()) {
    if (responseCache.size <= MAX_RESPONSE_CACHE_ENTRIES) {
      return
    }

    responseCache.delete(cacheKey)
  }
}

type RetriableRequestConfig = InternalAxiosRequestConfig & {
  retryCount?: number
}

type ApiGetOptions = Omit<AxiosRequestConfig, 'url' | 'method'> & {
  cacheTtlMs?: number
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

export const apiGet = async <T>(
  url: string,
  {
    cacheTtlMs = 0,
    params,
    ...config
  }: ApiGetOptions = {},
): Promise<T> => {
  const cacheKey =
    cacheTtlMs > 0 ? buildRequestCacheKey(url, params) : null

  if (cacheKey) {
    const now = Date.now()
    pruneResponseCache(now)
    const cached = responseCache.get(cacheKey)

    if (cached && cached.expiresAt > now) {
      return cached.data as T
    }

    const inflight = inflightRequests.get(cacheKey)
    if (inflight) {
      return inflight as Promise<T>
    }
  }

  const request = apiClient
    .get<T>(url, {
      ...config,
      params,
    })
    .then((response) => {
      if (cacheKey && cacheTtlMs > 0) {
        responseCache.set(cacheKey, {
          data: response.data,
          expiresAt: Date.now() + cacheTtlMs,
        })
      }

      return response.data
    })
    .finally(() => {
      if (cacheKey) {
        inflightRequests.delete(cacheKey)
      }
    })

  if (cacheKey) {
    inflightRequests.set(cacheKey, request)
  }

  return request
}

export const apiPut = async <TResponse, TBody>(
  url: string,
  data: TBody,
  config: Omit<AxiosRequestConfig, 'url' | 'method' | 'data'> = {},
): Promise<TResponse> => {
  const response = await apiClient.put<TResponse>(url, data, config)
  return response.data
}

export const apiDelete = async <TResponse>(
  url: string,
  config: Omit<AxiosRequestConfig, 'url' | 'method'> = {},
): Promise<TResponse> => {
  const response = await apiClient.delete<TResponse>(url, config)
  return response.data
}

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
