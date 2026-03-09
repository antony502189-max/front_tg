import { apiGet } from './client'
import type { Lesson } from '../store/scheduleStore'
import type { UserRole } from '../types/user'

export type ScheduleViewMode = 'day' | 'week' | 'month' | 'semester'
export type ScheduleWeekNumber = 1 | 2 | 3 | 4

export type DaySchedule = {
  date: string
  lessons: Lesson[]
}

export type ScheduleResponse = {
  view: ScheduleViewMode
  currentWeek: ScheduleWeekNumber
  selectedWeek: ScheduleWeekNumber
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
  subgroup?: "all" | "1" | "2"
  week?: ScheduleWeekNumber
}

export async function fetchSchedule(
  {
    role,
    date,
    view,
    groupNumber,
    teacherUrlId,
    teacherEmployeeId,
    subgroup,
    week,
  }: FetchScheduleParams,
  signal?: AbortSignal,
): Promise<ScheduleResponse> {
  const params: Record<string, string> = {
    date,
    view,
  }

  if (week) {
    params.week = String(week)
  }

  if (role === 'student') {
    params.studentGroup = groupNumber?.trim() ?? ''
    if (subgroup && subgroup !== 'all') {
      params.subgroup = subgroup
    }
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
