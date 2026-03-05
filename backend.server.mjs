import { createServer } from 'node:http'
import { URL } from 'node:url'
import axios from 'axios'

const PORT = Number(process.env.PORT ?? 8787)
const IIS_BASE_URL = process.env.IIS_BASE_URL ?? 'https://iis.bsuir.by/api'
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS ?? 60_000)
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 10_000)
const MAX_RETRIES = Number(process.env.MAX_RETRIES ?? 2)

const upstream = axios.create({
  baseURL: IIS_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
})

const cache = new Map()

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

function readCache(key) {
  const item = cache.get(key)

  if (!item) {
    return undefined
  }

  if (Date.now() > item.expiresAt) {
    cache.delete(key)
    return undefined
  }

  return item.payload
}

function writeCache(key, payload) {
  cache.set(key, {
    payload,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
}

async function fetchWithRetry(path, params) {
  let lastError

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await upstream.get(path, { params })
      return response.data
    } catch (error) {
      lastError = error
      const status = error.response?.status
      const shouldRetry = !status || status >= 500

      if (!shouldRetry || attempt === MAX_RETRIES) {
        throw error
      }
    }
  }

  throw lastError
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

createServer(async (req, res) => {
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

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`)

  if (parsedUrl.pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'front_tg_backend',
      iisBaseUrl: IIS_BASE_URL,
    })
  }

  const config = routeConfig(parsedUrl.pathname)

  if (!config) {
    return sendJson(res, 404, { error: 'Not found' })
  }

  const queryValue = parsedUrl.searchParams.get(config.queryParam)

  if (!queryValue || queryValue.trim().length < config.minLength) {
    return sendJson(res, 400, {
      error: `Query param \"${config.queryParam}\" is required`,
    })
  }

  const normalized = queryValue.trim()
  const params = { [config.queryParam]: normalized }
  const key = cacheKey(config.upstreamPath, params)
  const cached = readCache(key)

  if (cached !== undefined) {
    return sendJson(res, 200, cached)
  }

  try {
    const payload = await fetchWithRetry(config.upstreamPath, params)
    writeCache(key, payload)
    return sendJson(res, 200, payload)
  } catch (error) {
    const status = error.response?.status ?? 502
    const message =
      error.response?.data?.message ??
      error.response?.data?.error ??
      'Upstream API request failed'

    return sendJson(res, status, {
      error: message,
      upstreamStatus: error.response?.status,
    })
  }
}).listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`)
})
