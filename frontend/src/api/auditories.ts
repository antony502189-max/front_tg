import { apiGet } from './client'
import type { FreeAuditory, UserRole } from '../types/user'

export type Auditory = Omit<FreeAuditory, 'nextBusyLesson'>

export type FreeAuditoriesResponse = {
  generatedAt: string
  items: FreeAuditory[]
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

type FreeAuditoriesParams = {
  role: UserRole
  query: string
  groupNumber?: string
  teacherUrlId?: string
  teacherEmployeeId?: string
}

export async function fetchFreeAuditories(
  {
    role,
    query,
    groupNumber,
    teacherUrlId,
    teacherEmployeeId,
  }: FreeAuditoriesParams,
  signal?: AbortSignal,
): Promise<FreeAuditoriesResponse> {
  const params: Record<string, string> = {
    query: query.trim(),
  }

  if (role === 'student') {
    params.studentGroup = groupNumber?.trim() ?? ''
  } else {
    params.teacherUrlId = teacherUrlId?.trim() ?? ''
    if (teacherEmployeeId?.trim()) {
      params.teacherEmployeeId = teacherEmployeeId.trim()
    }
  }

  return apiGet<FreeAuditoriesResponse>('/free-auditories', {
    params,
    signal,
    cacheTtlMs: 30_000,
  })
}
