import WebApp from '@twa-dev/sdk'

const SESSION_STORAGE_KEY = 'bsuir-nexus:session-user-id'

const createLocalSessionId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `local:${crypto.randomUUID()}`
  }

  return `local:${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const resolveSessionUserId = () => {
  if (typeof window === 'undefined') {
    return 'server:session'
  }

  const telegramUserId = WebApp.initDataUnsafe.user?.id
  if (telegramUserId != null) {
    const resolved = `tg:${telegramUserId}`
    window.localStorage.setItem(SESSION_STORAGE_KEY, resolved)
    return resolved
  }

  const persisted = window.localStorage.getItem(SESSION_STORAGE_KEY)
  if (persisted) {
    return persisted
  }

  const generated = createLocalSessionId()
  window.localStorage.setItem(SESSION_STORAGE_KEY, generated)
  return generated
}
