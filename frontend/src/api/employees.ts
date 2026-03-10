import { apiGet } from './client'
import type { EmployeeSearchResult } from '../types/user'

export type Employee = EmployeeSearchResult

const EMPLOYEE_SEARCH_TIMEOUT_MS = 12_000

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
