import { apiGet } from './client'
import type { Lesson } from '../store/scheduleStore'
import type { UserRole } from '../types/user'

export type ScheduleViewMode = 'day' | 'week' | 'month' | 'semester'

export type DaySchedule = {
  date: string
  lessons: Lesson[]
}

export type ScheduleResponse = {
  view: ScheduleViewMode
  rangeStart: string
  rangeEnd: string
  days: DaySchedule[]
}

type FetchScheduleParams = {
  role: UserRole
  date: string
  view: ScheduleViewMode
  groupNumber?: string
  teacherUrlId?: string
  teacherEmployeeId?: string
}

export async function fetchSchedule(
  {
    role,
    date,
    view,
    groupNumber,
    teacherUrlId,
    teacherEmployeeId,
  }: FetchScheduleParams,
  signal?: AbortSignal,
): Promise<ScheduleResponse> {
  const params: Record<string, string> = {
    date,
    view,
  }

  if (role === 'student') {
    params.studentGroup = groupNumber?.trim() ?? ''
  } else {
    params.teacherUrlId = teacherUrlId?.trim() ?? ''
    if (teacherEmployeeId?.trim()) {
      params.teacherEmployeeId = teacherEmployeeId.trim()
    }
  }

  return apiGet<ScheduleResponse>('/schedule', {
    params,
    signal,
    cacheTtlMs: 60_000,
  })
}

export async function fetchStudentSchedule(
  groupNumber: string,
  signal?: AbortSignal,
): Promise<ScheduleResponse> {
  return fetchSchedule(
    {
      role: 'student',
      groupNumber,
      view: 'week',
      date: new Date().toISOString().slice(0, 10),
    },
    signal,
  )
}
