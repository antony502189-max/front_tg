import { apiClient } from './client'

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

export async function searchAuditories(query: string): Promise<Auditory[]> {
  const trimmed = query.trim()

  if (!trimmed) {
    return []
  }

  const response = await apiClient.get<Auditory[]>('/auditories', {
    params: { q: trimmed },
  })

  return response.data
}
