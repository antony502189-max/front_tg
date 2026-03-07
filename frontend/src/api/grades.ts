import { apiGet, LONG_API_TIMEOUT_MS } from './client'
import type { GradesResponse } from '../types/grades'

export type {
  GradeMark,
  GradesResponse,
  GradesSummary,
  SubjectGrades,
} from '../types/grades'

const GRADES_API_TIMEOUT_MS = LONG_API_TIMEOUT_MS * 3

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const normalized = Number(value.replace(',', '.').trim())
    return Number.isFinite(normalized) ? normalized : undefined
  }

  return undefined
}

const toString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

const getRecord = (
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null => {
  const value = payload[key]
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null
}

const firstDefined = (...values: Array<unknown>): unknown =>
  values.find((value) => value !== undefined && value !== null)

const normalizeSummary = (payload: Record<string, unknown>) => {
  const summary = getRecord(payload, 'summary')
  const stats = getRecord(payload, 'stats')

  const average = toNumber(
    firstDefined(
      summary?.average,
      summary?.avg,
      summary?.averageScore,
      summary?.gpa,
      stats?.average,
      stats?.gpa,
      payload.average,
      payload.avg,
      payload.averageScore,
      payload.gpa,
    ),
  )

  const position = toNumber(
    firstDefined(
      summary?.position,
      summary?.rank,
      summary?.ratingPosition,
      stats?.position,
      stats?.rank,
      payload.position,
      payload.rank,
      payload.ratingPosition,
    ),
  )

  const speciality = toString(
    firstDefined(
      summary?.speciality,
      summary?.specialty,
      summary?.specialityAbbrev,
      summary?.specialityName,
      stats?.speciality,
      payload.speciality,
      payload.specialty,
      payload.specialityAbbrev,
      payload.specialityName,
    ),
  )

  if (
    average === undefined &&
    position === undefined &&
    speciality === undefined
  ) {
    return undefined
  }

  return {
    ...(average !== undefined ? { average } : {}),
    ...(position !== undefined ? { position } : {}),
    ...(speciality ? { speciality } : {}),
  }
}

export async function fetchGrades(
  studentCardNumber: string,
  options: {
    groupNumber?: string
    signal?: AbortSignal
  } = {},
): Promise<GradesResponse> {
  const { groupNumber, signal } = options
  const normalizedStudentCardNumber = studentCardNumber.trim()
  const normalizedGroupNumber = groupNumber?.trim()
  const params: Record<string, string> = {}

  if (normalizedGroupNumber) {
    params.studentGroup = normalizedGroupNumber
  }

  const payload = await apiGet<GradesResponse & Record<string, unknown>>(
    `/rating/${encodeURIComponent(normalizedStudentCardNumber)}`,
    {
      params,
      timeout: GRADES_API_TIMEOUT_MS,
      signal,
      cacheTtlMs: 60_000,
    },
  )

  return {
    ...payload,
    summary: normalizeSummary(payload),
  }
}
