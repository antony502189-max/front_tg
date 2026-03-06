import { apiGet } from './client'

export type Employee = {
  id: string
  fullName: string
  position?: string
  department?: string
  avatarUrl?: string
}

export async function searchTeachers(
  query: string,
  signal?: AbortSignal,
): Promise<Employee[]> {
  const trimmed = query.trim()

  if (!trimmed) {
    return []
  }

  return apiGet<Employee[]>('/employees', {
    params: { q: trimmed },
    signal,
    cacheTtlMs: 5 * 60_000,
  })
}

