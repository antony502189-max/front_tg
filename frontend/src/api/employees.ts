import { apiGet } from './client'
import type { EmployeeSearchResult } from '../types/user'

export type Employee = EmployeeSearchResult

export async function searchTeachers(
  query: string,
  signal?: AbortSignal,
): Promise<Employee[]> {
  const trimmed = query.trim()

  if (!trimmed) {
    return []
  }

  return apiGet<Employee[]>('/search-employee', {
    params: { query: trimmed },
    signal,
    cacheTtlMs: 5 * 60_000,
  })
}
