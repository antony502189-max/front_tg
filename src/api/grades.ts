import axios from 'axios'
import { apiClient } from './client'
import type {
  GradeMark,
  GradesResponse,
  SubjectGrades,
} from '../mocks/grades'
import { getMockGrades } from '../mocks/grades'

type RawGradesResponse = unknown

function isAxiosError(error: unknown): error is axios.AxiosError {
  return axios.isAxiosError(error)
}

function isAuthOrForbiddenError(error: unknown): boolean {
  if (!isAxiosError(error)) {
    return false
  }

  const status = error.response?.status

  return status === 401 || status === 403
}

function mapRawGradesResponse(data: RawGradesResponse): GradesResponse {
  if (!data || typeof data !== 'object') {
    return { subjects: [] }
  }

  const anyData = data as {
    subjects?: unknown
    average?: unknown
    avgRating?: unknown
    position?: unknown
    ratingPlace?: unknown
    speciality?: unknown
    specialty?: unknown
  }

  const subjectsArray = Array.isArray(anyData.subjects)
    ? (anyData.subjects as unknown[])
    : []

  const subjects: SubjectGrades[] = subjectsArray.map(
    (rawSubject, index): SubjectGrades => {
      const subjectAny = rawSubject as {
        id?: unknown
        name?: unknown
        subject?: unknown
        teacher?: unknown
        marks?: unknown
      }

      const marksSource = Array.isArray(subjectAny.marks)
        ? (subjectAny.marks as unknown[])
        : []

      const marks: GradeMark[] = marksSource
        .map((rawMark): GradeMark | null => {
          const markAny = rawMark as {
            value?: unknown
            mark?: unknown
            score?: unknown
            date?: unknown
          }

          const numericValue = Number(
            markAny.value ?? markAny.mark ?? markAny.score,
          )

          if (!Number.isFinite(numericValue)) {
            return null
          }

          return {
            value: numericValue,
            date:
              typeof markAny.date === 'string' && markAny.date.length > 0
                ? markAny.date
                : undefined,
          }
        })
        .filter((mark): mark is GradeMark => mark !== null)

      const subjectNameSource =
        subjectAny.name ?? subjectAny.subject ?? 'Дисциплина'

      const subjectName =
        typeof subjectNameSource === 'string'
          ? subjectNameSource
          : 'Дисциплина'

      const teacher =
        typeof subjectAny.teacher === 'string' && subjectAny.teacher.length > 0
          ? subjectAny.teacher
          : undefined

      return {
        id: String(subjectAny.id ?? index),
        subject: subjectName,
        teacher,
        marks,
      }
    },
  )

  const summaryAverageSource =
    anyData.average ?? anyData.avgRating ?? undefined
  const summaryPositionSource =
    anyData.position ?? anyData.ratingPlace ?? undefined
  const summarySpecialitySource =
    anyData.speciality ?? anyData.specialty ?? undefined

  const average =
    typeof summaryAverageSource === 'number'
      ? summaryAverageSource
      : undefined

  const position =
    typeof summaryPositionSource === 'number'
      ? summaryPositionSource
      : undefined

  const speciality =
    typeof summarySpecialitySource === 'string'
      ? summarySpecialitySource
      : undefined

  const summary =
    average !== undefined ||
    position !== undefined ||
    (speciality !== undefined && speciality.length > 0)
      ? {
          average,
          position,
          speciality,
        }
      : undefined

  return {
    summary,
    subjects,
  }
}

export async function fetchGrades(
  studentCardNumber: string,
): Promise<GradesResponse> {
  try {
    const response = await apiClient.get<RawGradesResponse>('/grades', {
      params: { studentCardNumber },
    })

    return mapRawGradesResponse(response.data)
  } catch (error) {
    if (isAuthOrForbiddenError(error)) {
      return getMockGrades(studentCardNumber)
    }

    if (isAxiosError(error)) {
      return getMockGrades(studentCardNumber)
    }

    return getMockGrades(studentCardNumber)
  }
}

