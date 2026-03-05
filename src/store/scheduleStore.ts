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

type ScheduleState = {
  isLoading: boolean
  error: string | null
  lessonsByDate: Record<string, Lesson[]>
  setLoading: (isLoading: boolean) => void
  setError: (error: string | null) => void
  setSchedule: (days: Array<{ date: string; lessons: Lesson[] }>) => void
  clearSchedule: () => void
  getLessonsForDate: (date: string) => Lesson[]
  getTodayLessons: () => Lesson[]
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
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
      lessonsByDate: Object.fromEntries(
        days.map((day) => [day.date, day.lessons]),
      ),
    })
  },
  clearSchedule: () => {
    set({ lessonsByDate: {} })
  },
  getLessonsForDate: (date) => {
    return get().lessonsByDate[date] ?? []
  },
  getTodayLessons: () => {
    return get().getLessonsForDate(toDateKey(new Date()))
  },
}))

