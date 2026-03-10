import { apiGet, DEFAULT_API_TIMEOUT_MS } from './client'
import type { EmployeeSearchResult } from '../types/user'

export type Employee = EmployeeSearchResult

const EMPLOYEE_SEARCH_TIMEOUT_MS = Math.min(
  DEFAULT_API_TIMEOUT_MS,
  4_000,
)

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
    timeout: EMPLOYEE_SEARCH_TIMEOUT_MS,
    cacheTtlMs: 5 * 60_000,
    retry: 'none',
  })
}
