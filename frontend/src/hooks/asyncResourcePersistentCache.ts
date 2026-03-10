type PersistentAsyncResourceCacheEntry<T> = {
  data: T
  updatedAt: number
  maxAgeMs: number | null
}

type StoredPersistentAsyncResourceCacheEntry = {
  data: unknown
  updatedAt: number
  maxAgeMs: number | null
}

const STORAGE_KEY = 'bsuir-nexus:async-resource-cache:v1'
const MAX_PERSISTED_ENTRIES = 80
const PRUNE_INTERVAL_MS = 60_000

let isLoaded = false
let lastPrunedAt = 0
let pendingSaveTimer: number | null = null
const persistentCache = new Map<
  string,
  StoredPersistentAsyncResourceCacheEntry
>()

const hasBrowserStorage = () =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const normalizeStoredEntry = (
  value: unknown,
): StoredPersistentAsyncResourceCacheEntry | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const updatedAt = record.updatedAt
  if (!isFiniteNumber(updatedAt)) {
    return null
  }

  const maxAgeMs = record.maxAgeMs

  return {
    data: record.data,
    updatedAt,
    maxAgeMs: isFiniteNumber(maxAgeMs) ? maxAgeMs : null,
  }
}

const prunePersistentCache = (
  now: number,
  force: boolean = false,
) => {
  if (!force && now - lastPrunedAt < PRUNE_INTERVAL_MS) {
    return false
  }

  lastPrunedAt = now
  let didChange = false

  for (const [cacheKey, entry] of persistentCache.entries()) {
    if (
      entry.maxAgeMs !== null &&
      entry.updatedAt + entry.maxAgeMs <= now
    ) {
      persistentCache.delete(cacheKey)
      didChange = true
    }
  }

  if (persistentCache.size <= MAX_PERSISTED_ENTRIES) {
    return didChange
  }

  const sortedEntries = [...persistentCache.entries()].sort(
    ([, left], [, right]) => right.updatedAt - left.updatedAt,
  )

  persistentCache.clear()
  didChange = true

  for (const [cacheKey, entry] of sortedEntries.slice(0, MAX_PERSISTED_ENTRIES)) {
    persistentCache.set(cacheKey, entry)
  }

  return didChange
}

const flushPersistentCacheSave = () => {
  pendingSaveTimer = null

  if (!hasBrowserStorage()) {
    return
  }

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(persistentCache.entries())),
    )
  } catch {
    // Ignore storage quota and serialization failures.
  }
}

const schedulePersistentCacheSave = () => {
  if (!hasBrowserStorage() || pendingSaveTimer !== null) {
    return
  }

  pendingSaveTimer = window.setTimeout(flushPersistentCacheSave, 0)
}

const ensurePersistentCacheLoaded = () => {
  if (isLoaded) {
    return
  }

  isLoaded = true

  if (!hasBrowserStorage()) {
    return
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY)
    if (!rawValue) {
      return
    }

    const payload = JSON.parse(rawValue)
    if (!payload || typeof payload !== 'object') {
      return
    }

    for (const [cacheKey, entry] of Object.entries(payload)) {
      if (!cacheKey) {
        continue
      }

      const normalizedEntry = normalizeStoredEntry(entry)
      if (normalizedEntry) {
        persistentCache.set(cacheKey, normalizedEntry)
      }
    }

    if (prunePersistentCache(Date.now(), true)) {
      schedulePersistentCacheSave()
    }
  } catch {
    persistentCache.clear()
  }
}

export const getPersistentAsyncResourceCacheEntry = <T,>(
  cacheKey: string | null,
) => {
  if (!cacheKey) {
    return null
  }

  ensurePersistentCacheLoaded()
  if (prunePersistentCache(Date.now())) {
    schedulePersistentCacheSave()
  }

  const entry = persistentCache.get(cacheKey)
  return entry
    ? (entry as PersistentAsyncResourceCacheEntry<T>)
    : null
}

export const setPersistentAsyncResourceCacheEntry = <T,>(
  cacheKey: string | null,
  entry: PersistentAsyncResourceCacheEntry<T>,
) => {
  if (!cacheKey) {
    return
  }

  ensurePersistentCacheLoaded()
  persistentCache.set(cacheKey, entry)
  prunePersistentCache(Date.now(), true)
  schedulePersistentCacheSave()
}
