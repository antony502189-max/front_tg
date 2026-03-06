import { apiGet, LONG_API_TIMEOUT_MS } from './client'
import type { GradesResponse } from '../types/grades'

export type {
  GradeMark,
  GradesResponse,
  GradesSummary,
  SubjectGrades,
} from '../types/grades'

export async function fetchGrades(
  studentCardNumber: string,
  signal?: AbortSignal,
): Promise<GradesResponse> {
  return apiGet<GradesResponse>('/grades', {
    params: { studentCardNumber: studentCardNumber.trim() },
    timeout: LONG_API_TIMEOUT_MS,
    signal,
    cacheTtlMs: 60_000,
  })
}

