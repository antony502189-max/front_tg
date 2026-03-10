import WebApp from '@twa-dev/sdk'

const SESSION_STORAGE_KEY = 'bsuir-nexus:session-user-id'

export type SessionContext = {
  sessionUserId: string
  previousSessionUserId: string | null
}

const createLocalSessionId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `local:${crypto.randomUUID()}`
  }

  return `local:${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const readStoredSessionUserId = () => {
  if (typeof window === 'undefined') {
    return null
  }

  const persisted = window.localStorage.getItem(SESSION_STORAGE_KEY)
  if (!persisted) {
    return null
  }

  const normalized = persisted.trim()
  return normalized || null
}

export const resolveSessionContext = (): SessionContext => {
  if (typeof window === 'undefined') {
    return {
      sessionUserId: 'server:session',
      previousSessionUserId: null,
    }
  }

  const persistedSessionUserId = readStoredSessionUserId()
  const telegramUserId = WebApp.initDataUnsafe.user?.id

  if (telegramUserId != null) {
    const resolved = `tg:${telegramUserId}`
    window.localStorage.setItem(SESSION_STORAGE_KEY, resolved)

    return {
      sessionUserId: resolved,
      previousSessionUserId:
        persistedSessionUserId?.startsWith('local:') &&
        persistedSessionUserId !== resolved
          ? persistedSessionUserId
          : null,
    }
  }

  if (persistedSessionUserId) {
    return {
      sessionUserId: persistedSessionUserId,
      previousSessionUserId: null,
    }
  }

  const generated = createLocalSessionId()
  window.localStorage.setItem(SESSION_STORAGE_KEY, generated)

  return {
    sessionUserId: generated,
    previousSessionUserId: null,
  }
}

export const resolveSessionUserId = () =>
  resolveSessionContext().sessionUserId
