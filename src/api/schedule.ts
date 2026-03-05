import { apiClient } from './client'
import type { Lesson } from '../store/scheduleStore'

export type DaySchedule = {
  date: string
  lessons: Lesson[]
}

export type WeekSchedule = {
  days: DaySchedule[]
}

type RawLesson = {
  id?: string | number
  subject?: string
  employee?: string
  auditory?: string
  lessonType?: string
  startLessonTime?: string
  endLessonTime?: string
  date?: string
  [key: string]: unknown
}

type RawDaySchedule = {
  date?: string
  lessons?: RawLesson[]
}

type NormalizedLesson = {
  id?: string | number
  subject?: string
  teacher?: string
  room?: string
  type?: string
  startTime?: string
  endTime?: string
  date?: string
}

type NormalizedDaySchedule = {
  date?: string
  lessons?: NormalizedLesson[]
}

type NormalizedWeekSchedule = {
  days?: NormalizedDaySchedule[]
}

const FALLBACK_SUBJECT = 'Дисциплина'

const FALLBACK_DATE = '1970-01-01'

function mapRawLessonToLesson(raw: RawLesson, dateFallback: string): Lesson {
  const date = raw.date ?? dateFallback

  return {
    id: String(raw.id ?? `${date}-${raw.subject ?? FALLBACK_SUBJECT}`),
    subject: raw.subject ?? FALLBACK_SUBJECT,
    teacher: typeof raw.employee === 'string' ? raw.employee : undefined,
    room: typeof raw.auditory === 'string' ? raw.auditory : undefined,
    type: typeof raw.lessonType === 'string' ? raw.lessonType : undefined,
    startTime: typeof raw.startLessonTime === 'string' ? raw.startLessonTime : '',
    endTime: typeof raw.endLessonTime === 'string' ? raw.endLessonTime : '',
    date,
  }
}

function mapNormalizedLessonToLesson(
  raw: NormalizedLesson,
  dateFallback: string,
): Lesson {
  const date = raw.date ?? dateFallback

  return {
    id: String(raw.id ?? `${date}-${raw.subject ?? FALLBACK_SUBJECT}`),
    subject: raw.subject ?? FALLBACK_SUBJECT,
    teacher: typeof raw.teacher === 'string' ? raw.teacher : undefined,
    room: typeof raw.room === 'string' ? raw.room : undefined,
    type: typeof raw.type === 'string' ? raw.type : undefined,
    startTime: typeof raw.startTime === 'string' ? raw.startTime : '',
    endTime: typeof raw.endTime === 'string' ? raw.endTime : '',
    date,
  }
}

function isNormalizedWeekSchedule(data: unknown): data is NormalizedWeekSchedule {
  return typeof data === 'object' && data !== null && 'days' in data
}

function mapNormalizedWeekSchedule(data: NormalizedWeekSchedule): WeekSchedule {
  const daysSource = Array.isArray(data.days) ? data.days : []

  return {
    days: daysSource.map((day, index) => {
      const date = day.date ?? FALLBACK_DATE
      const lessonsSource = Array.isArray(day.lessons) ? day.lessons : []

      return {
        date: date || `${FALLBACK_DATE}-${index}`,
        lessons: lessonsSource.map((lesson) =>
          mapNormalizedLessonToLesson(lesson, date),
        ),
      }
    }),
  }
}

export async function fetchStudentSchedule(
  groupNumber: string,
): Promise<WeekSchedule> {
  const response = await apiClient.get<unknown>('/schedule', {
    params: { studentGroup: groupNumber },
  })

  if (isNormalizedWeekSchedule(response.data)) {
    return mapNormalizedWeekSchedule(response.data)
  }

  const rawDays = Array.isArray(response.data)
    ? (response.data as RawDaySchedule[])
    : []

  const days: DaySchedule[] = rawDays.map((day, index) => {
    const date = day.date ?? FALLBACK_DATE

    const lessons =
      day.lessons?.map((lesson) =>
        mapRawLessonToLesson(lesson, date),
      ) ?? []

    return {
      date: date || `${FALLBACK_DATE}-${index}`,
      lessons,
    }
  })

  return { days }
}

