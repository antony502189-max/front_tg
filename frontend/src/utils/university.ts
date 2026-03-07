import type { Auditory } from '../api/auditories'
import type { ScheduleResponse } from '../api/schedule'
import type { Lesson } from '../store/scheduleStore'
import {
  buildDateTime,
  parseDateKey,
  toDateKey,
} from './date'

export type AuditoryUsage = {
  date: string
  lesson: Lesson
}

export type RoomResult = {
  auditory: Auditory
  usage: AuditoryUsage[]
  current: AuditoryUsage | null
  next: AuditoryUsage | null
}

const roomStatusDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

const normalizeRoomToken = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[.,]/g, '')
    .replace(/\u043a\u043e\u0440\u043f\u0443\u0441/g, '\u043a')

const getAuditoryTokens = (auditory: Auditory) => {
  const buildingDigits = auditory.building?.match(/\d+/)?.[0] ?? ''
  const tokens = [
    auditory.fullName,
    `${auditory.name}-${auditory.building ?? ''}`,
    buildingDigits ? `${auditory.name}-${buildingDigits}\u043a` : auditory.name,
    auditory.name,
  ]

  return tokens
    .map(normalizeRoomToken)
    .filter(Boolean)
}

const lessonMatchesAuditory = (
  room: string | undefined,
  auditoryTokens: string[],
) => {
  if (!room) {
    return false
  }

  const roomTokens = room
    .split(',')
    .map((item) => normalizeRoomToken(item))
    .filter(Boolean)

  return roomTokens.some((roomToken) =>
    auditoryTokens.some(
      (auditoryToken) =>
        roomToken === auditoryToken ||
        roomToken.includes(auditoryToken) ||
        auditoryToken.includes(roomToken),
    ),
  )
}

export const getInitials = (fullName: string) => {
  const parts = fullName
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)

  if (!parts.length) {
    return ''
  }

  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase()
  }

  return (parts[0]![0] + parts[1]![0]).toUpperCase()
}

export const collectAuditoryUsage = (
  auditory: Auditory,
  schedule: ScheduleResponse | null,
) => {
  if (!schedule) {
    return []
  }

  const auditoryTokens = getAuditoryTokens(auditory)

  return schedule.days
    .flatMap((day) =>
      day.lessons
        .filter((lesson) =>
          lessonMatchesAuditory(lesson.room, auditoryTokens),
        )
        .map((lesson) => ({
          date: day.date,
          lesson,
        })),
    )
    .sort((left, right) => {
      const leftStart =
        buildDateTime(left.date, left.lesson.startTime)?.getTime() ?? 0
      const rightStart =
        buildDateTime(right.date, right.lesson.startTime)?.getTime() ?? 0

      return leftStart - rightStart
    })
}

export const formatUniversityDateLabel = (dateKey: string) => {
  const parsed = parseDateKey(dateKey)

  if (!parsed) {
    return dateKey
  }

  return roomStatusDateFormatter.format(parsed)
}

export const describeAuditoryStatus = (
  usage: AuditoryUsage[],
  now = new Date(),
) => {
  const todayKey = toDateKey(now)

  let current: AuditoryUsage | null = null
  let next: AuditoryUsage | null = null

  for (const item of usage) {
    const start = buildDateTime(item.date, item.lesson.startTime)
    const end = buildDateTime(item.date, item.lesson.endTime)

    if (!start || !end) {
      continue
    }

    if (item.date === todayKey && now >= start && now <= end) {
      current = item
      break
    }

    if (now < start) {
      next = item
      break
    }
  }

  return { current, next }
}
