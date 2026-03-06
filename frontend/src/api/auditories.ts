import { apiGet } from './client'

export type Auditory = {
  id: string
  name: string
  building?: string
  fullName: string
  type?: string
  typeAbbrev?: string
  capacity?: number | null
  department?: string
  note?: string
}

export async function searchAuditories(
  query: string,
  signal?: AbortSignal,
): Promise<Auditory[]> {
  const trimmed = query.trim()

  if (!trimmed) {
    return []
  }

  return apiGet<Auditory[]>('/auditories', {
    params: { q: trimmed },
    signal,
    cacheTtlMs: 5 * 60_000,
  })
}
