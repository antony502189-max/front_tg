import { createServer } from 'node:http'
import { URL } from 'node:url'
import axios from 'axios'

function parseNumberEnv(name, fallback) {
  const raw = process.env[name]
  const parsed = Number(raw)

  if (!raw || !Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }

  return parsed
}

const CONFIG = {
  port: parseNumberEnv('PORT', 8787),
  iisBaseUrl: process.env.IIS_BASE_URL ?? 'https://iis.bsuir.by/api',
  cacheTtlMs: parseNumberEnv('CACHE_TTL_MS', 60_000),
  staleTtlMs: parseNumberEnv('STALE_TTL_MS', 300_000),
  requestTimeoutMs: parseNumberEnv('REQUEST_TIMEOUT_MS', 10_000),
  maxRetries: parseNumberEnv('MAX_RETRIES', 2),
  retryDelayMs: parseNumberEnv('RETRY_DELAY_MS', 250),
}

const upstream = axios.create({
  baseURL: CONFIG.iisBaseUrl,
  timeout: CONFIG.requestTimeoutMs,
})

const cache = new Map()
const startedAt = Date.now()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })

  res.end(JSON.stringify(payload))
}

function cacheKey(path, params) {
  const serialized = new URLSearchParams(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  ).toString()

  return `${path}?${serialized}`
}

function readFreshCache(store, key) {
  const item = store.get(key)

  if (!item) {
    return undefined
  }

  if (Date.now() <= item.freshUntil) {
    return item.payload
  }

  return undefined
}

function readStaleCache(store, key) {
  const item = store.get(key)

  if (!item) {
    return undefined
  }

  if (Date.now() <= item.staleUntil) {
    return item.payload
  }

  store.delete(key)
  return undefined
}

function writeCache(store, key, payload, cacheTtlMs, staleTtlMs) {
  const now = Date.now()
  store.set(key, {
    payload,
    freshUntil: now + cacheTtlMs,
    staleUntil: now + cacheTtlMs + staleTtlMs,
  })
}

function routeConfig(pathname) {
  if (pathname === '/api/schedule') {
    return { upstreamPath: '/schedule', queryParam: 'studentGroup', minLength: 1 }
  }

  if (pathname === '/api/grades') {
    return {
      upstreamPath: '/grades',
      queryParam: 'studentCardNumber',
      minLength: 1,
    }
  }

  if (pathname === '/api/employees') {
    return { upstreamPath: '/employees', queryParam: 'q', minLength: 2 }
  }

  return null
}

function shouldRetry(error) {
  const status = error?.response?.status
  return !status || status >= 500 || status === 429
}

async function fetchWithRetry(fetcher, path, params, maxRetries, retryDelayMs) {
  let lastError

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fetcher(path, params)
    } catch (error) {
      lastError = error

      if (!shouldRetry(error) || attempt === maxRetries) {
        throw error
      }

      await sleep(retryDelayMs * (attempt + 1))
    }
  }

  throw lastError
}

function createFetcher(client) {
  return async (path, params) => {
    const response = await client.get(path, { params })
    return response.data
  }
}

export function createRequestHandler({
  config = CONFIG,
  store = cache,
  fetcher = createFetcher(upstream),
  now = () => Date.now(),
} = {}) {
  return async (req, res) => {
    if (!req.url) {
      return sendJson(res, 400, { error: 'Bad request' })
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      res.end()
      return
    }

    if (req.method !== 'GET') {
      return sendJson(res, 405, { error: 'Method not allowed' })
    }

    const parsedUrl = new URL(req.url, `http://localhost:${config.port}`)

    if (parsedUrl.pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'front_tg_backend',
        iisBaseUrl: config.iisBaseUrl,
        uptimeMs: now() - startedAt,
        cacheEntries: store.size,
      })
    }

    const route = routeConfig(parsedUrl.pathname)

    if (!route) {
      return sendJson(res, 404, { error: 'Not found' })
    }

    const queryValue = parsedUrl.searchParams.get(route.queryParam)

    if (!queryValue || queryValue.trim().length < route.minLength) {
      return sendJson(res, 400, {
        error: `Query param \"${route.queryParam}\" is required`,
      })
    }

    const normalized = queryValue.trim()
    const params = { [route.queryParam]: normalized }
    const key = cacheKey(route.upstreamPath, params)
    const cached = readFreshCache(store, key)

    if (cached !== undefined) {
      return sendJson(res, 200, cached)
    }

    try {
      const payload = await fetchWithRetry(
        fetcher,
        route.upstreamPath,
        params,
        config.maxRetries,
        config.retryDelayMs,
      )

      writeCache(
        store,
        key,
        payload,
        config.cacheTtlMs,
        config.staleTtlMs,
      )

      return sendJson(res, 200, payload)
    } catch (error) {
      const stalePayload = readStaleCache(store, key)

      if (stalePayload !== undefined) {
        return sendJson(res, 200, stalePayload)
      }

      const status = error?.response?.status ?? 502
      const message =
        error?.response?.data?.message ??
        error?.response?.data?.error ??
        'Upstream API request failed'

      return sendJson(res, status, {
        error: message,
        upstreamStatus: error?.response?.status,
      })
    }
  }
}

if (process.env.NODE_ENV !== 'test') {
  createServer(createRequestHandler()).listen(CONFIG.port, () => {
    console.log(`[backend] listening on http://localhost:${CONFIG.port}`)
  })
}

export { CONFIG, cacheKey, readFreshCache, readStaleCache, writeCache, fetchWithRetry, routeConfig }
