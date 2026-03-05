import { create } from 'zustand'

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
    set((state) => ({
      ...state,
      isLoading,
    }))
  },
  setError: (error) => {
    set((state) => ({
      ...state,
      error,
    }))
  },
  setSchedule: (days) => {
    set((state) => ({
      ...state,
      lessonsByDate: Object.fromEntries(
        days.map((day) => [day.date, day.lessons]),
      ),
    }))
  },
  clearSchedule: () => {
    set((state) => ({
      ...state,
      lessonsByDate: {},
    }))
  },
  getLessonsForDate: (date) => {
    return get().lessonsByDate[date] ?? []
  },
  getTodayLessons: () => {
    const today = new Date()
    const dateKey = today.toISOString().slice(0, 10)
    return get().getLessonsForDate(dateKey)
  },
}))

