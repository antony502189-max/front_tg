import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequestHandler, routeConfig, cacheKey, writeCache, readFreshCache, readStaleCache } from './backend.server.mjs'

function createMockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(code, headers) {
      this.statusCode = code
      this.headers = headers
    },
    end(payload = '') {
      this.body = payload
    },
  }
}

test('routeConfig resolves known routes', () => {
  assert.equal(routeConfig('/api/schedule')?.upstreamPath, '/schedule')
  assert.equal(routeConfig('/api/grades')?.queryParam, 'studentCardNumber')
  assert.equal(routeConfig('/api/employees')?.minLength, 2)
  assert.equal(routeConfig('/unknown'), null)
})

test('returns 400 when required query is missing', async () => {
  const handler = createRequestHandler({ fetcher: async () => ({}) })
  const req = { method: 'GET', url: '/api/schedule' }
  const res = createMockResponse()

  await handler(req, res)

  assert.equal(res.statusCode, 400)
  const payload = JSON.parse(res.body)
  assert.match(payload.error, /studentGroup/)
})

test('serves fresh cache without calling upstream', async () => {
  let fetchCount = 0
  const store = new Map()
  const key = cacheKey('/schedule', { studentGroup: '353502' })

  writeCache(store, key, [{ date: '2026-01-01', lessons: [] }], 60_000, 120_000)

  const handler = createRequestHandler({
    store,
    fetcher: async () => {
      fetchCount += 1
      return []
    },
  })

  const req = { method: 'GET', url: '/api/schedule?studentGroup=353502' }
  const res = createMockResponse()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(fetchCount, 0)
  assert.deepEqual(JSON.parse(res.body), [{ date: '2026-01-01', lessons: [] }])
})

test('returns stale cache when upstream fails', async () => {
  const store = new Map()
  const key = cacheKey('/grades', { studentCardNumber: '123' })
  const now = Date.now()

  store.set(key, {
    payload: { subjects: [{ id: '1' }] },
    freshUntil: now - 1,
    staleUntil: now + 60_000,
  })

  const handler = createRequestHandler({
    store,
    config: {
      port: 8787,
      iisBaseUrl: 'https://iis.bsuir.by/api',
      cacheTtlMs: 10,
      staleTtlMs: 100,
      requestTimeoutMs: 100,
      maxRetries: 0,
      retryDelayMs: 1,
    },
    fetcher: async () => {
      const error = new Error('forbidden')
      error.response = { status: 403, data: { error: 'denied' } }
      throw error
    },
  })

  const req = { method: 'GET', url: '/api/grades?studentCardNumber=123' }
  const res = createMockResponse()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(res.body), { subjects: [{ id: '1' }] })
})

test('cache helpers respect fresh and stale windows', () => {
  const store = new Map()
  const key = cacheKey('/employees', { q: 'иван' })

  writeCache(store, key, [{ id: '1' }], 5, 10)

  assert.ok(readFreshCache(store, key) !== undefined)
  assert.ok(readStaleCache(store, key) !== undefined)
})
