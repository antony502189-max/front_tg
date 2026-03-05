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
  date: string
  lessons?: RawLesson[]
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

export async function fetchStudentSchedule(
  groupNumber: string,
): Promise<WeekSchedule> {
  const response = await apiClient.get<RawDaySchedule[]>('/schedule', {
    params: { studentGroup: groupNumber },
  })

  const rawDays = response.data ?? []

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

