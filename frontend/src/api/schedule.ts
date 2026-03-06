import { apiClient } from './client'
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
): Promise<WeekSchedule> {
  const response = await apiClient.get<WeekSchedule>('/schedule', {
    params: { studentGroup: groupNumber.trim() },
  })

  return response.data
}

