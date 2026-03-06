import { apiGet } from './client'
import type { Lesson } from '../store/scheduleStore'

export type DaySchedule = {
  date: string
  lessons: Lesson[]
}

export type WeekSchedule = {
  days: DaySchedule[]
}

export async function fetchStudentSchedule(
  groupNumber: string,
  signal?: AbortSignal,
): Promise<WeekSchedule> {
  return apiGet<WeekSchedule>('/schedule', {
    params: { studentGroup: groupNumber.trim() },
    signal,
    cacheTtlMs: 60_000,
  })
}

