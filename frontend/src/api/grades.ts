import { apiClient, LONG_API_TIMEOUT_MS } from './client'
import type { GradesResponse } from '../types/grades'

export type {
  GradeMark,
  GradesResponse,
  GradesSummary,
  SubjectGrades,
} from '../types/grades'

export async function fetchGrades(
  studentCardNumber: string,
): Promise<GradesResponse> {
  const response = await apiClient.get<GradesResponse>('/grades', {
    params: { studentCardNumber: studentCardNumber.trim() },
    timeout: LONG_API_TIMEOUT_MS,
  })

  return response.data
}

