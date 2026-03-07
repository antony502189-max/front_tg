import { create } from 'zustand'
import { toDateKey } from '../utils/date'

export type LessonType = 'lecture' | 'practice' | 'lab' | 'other'

export type Lesson = {
  id: string
  subject: string
  teacher?: string
  room?: string
  type?: string
  typeLabel?: string
  typeKey: LessonType
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
}

type ScheduleSlice = Pick<
  ScheduleState,
  'days' | 'isLoading' | 'error' | 'lessonsByDate'
>

const defaultState: ScheduleSlice = {
  days: [],
  isLoading: false,
  error: null,
  lessonsByDate: {},
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  ...defaultState,
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
    const { isLoading, error } = get()
    set({
      ...defaultState,
      isLoading,
      error,
    })
  },
}))

export const selectLessonsForDate =
  (date: string) => (state: ScheduleState) =>
    state.lessonsByDate[date] ?? EMPTY_LESSONS

export const selectTodayLessons = (state: ScheduleState) =>
  state.lessonsByDate[toDateKey(new Date())] ?? EMPTY_LESSONS
