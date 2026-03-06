import { create } from 'zustand'
import { toDateKey } from '../utils/date'

export type LessonType = 'lecture' | 'practice' | 'lab' | 'other'

export type Lesson = {
  id: string
  subject: string
  teacher?: string
  room?: string
  type?: LessonType | string
  startTime: string
  endTime: string
  date: string
}

export type ScheduleDay = {
  date: string
  lessons: Lesson[]
}

const EMPTY_LESSONS: Lesson[] = []

type ScheduleState = {
  days: ScheduleDay[]
  isLoading: boolean
  error: string | null
  lessonsByDate: Record<string, Lesson[]>
  setLoading: (isLoading: boolean) => void
  setError: (error: string | null) => void
  setSchedule: (days: ScheduleDay[]) => void
  clearSchedule: () => void
  getLessonsForDate: (date: string) => Lesson[]
  getTodayLessons: () => Lesson[]
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  days: [],
  isLoading: false,
  error: null,
  lessonsByDate: {},
  setLoading: (isLoading) => {
    set({ isLoading })
  },
  setError: (error) => {
    set({ error })
  },
  setSchedule: (days) => {
    set({
      days,
      lessonsByDate: Object.fromEntries(
        days.map((day) => [day.date, day.lessons]),
      ),
    })
  },
  clearSchedule: () => {
    set({ days: [], lessonsByDate: {} })
  },
  getLessonsForDate: (date) => {
    return get().lessonsByDate[date] ?? EMPTY_LESSONS
  },
  getTodayLessons: () => {
    return get().getLessonsForDate(toDateKey(new Date()))
  },
}))

