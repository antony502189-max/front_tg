import { useEffect, useMemo, useState } from 'react'
import type { WeekSchedule } from '../api/schedule'
import { fetchStudentSchedule } from '../api/schedule'
import { CalendarStrip } from '../components/schedule/CalendarStrip'
import { LessonCard } from '../components/schedule/LessonCard'
import { useScheduleStore, type Lesson } from '../store/scheduleStore'
import { useUserStore } from '../store/userStore'
import { buildDateTime, toDateKey } from '../utils/date'

const findCurrentAndNextLesson = (
  date: string,
  lessons: Lesson[],
  todayKey: string,
): { currentId: string | null; nextId: string | null } => {
  if (!lessons.length || date !== todayKey) {
    return { currentId: null, nextId: null }
  }

  const sorted = [...lessons].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  )

  const now = new Date()

  let currentId: string | null = null
  let nextId: string | null = null

  for (const lesson of sorted) {
    const start = buildDateTime(date, lesson.startTime)
    const end = buildDateTime(date, lesson.endTime)

    if (!start || !end) {
      continue
    }

    if (now >= start && now <= end) {
      currentId = lesson.id
      break
    }

    if (now < start) {
      nextId = lesson.id
      break
    }
  }

  return { currentId, nextId }
}

export const SchedulePage = () => {
  const groupNumber = useUserStore((state) => state.groupNumber)
  const normalizedGroupNumber = groupNumber?.trim() ?? ''

  const isLoading = useScheduleStore((state) => state.isLoading)
  const error = useScheduleStore((state) => state.error)
  const setLoading = useScheduleStore((state) => state.setLoading)
  const setError = useScheduleStore((state) => state.setError)
  const setSchedule = useScheduleStore((state) => state.setSchedule)
  const clearSchedule = useScheduleStore((state) => state.clearSchedule)

  const [selectedDate, setSelectedDate] = useState<string>(() =>
    toDateKey(new Date()),
  )
  const [week, setWeek] = useState<WeekSchedule | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const lessonsForSelectedDate = useScheduleStore((state) =>
    state.getLessonsForDate(selectedDate),
  )

  useEffect(() => {
    if (!normalizedGroupNumber) {
      setWeek(null)
      clearSchedule()
      setLoading(false)
      setError(
        'Добавьте учебную группу в настройках, чтобы видеть расписание.',
      )
      return
    }

    let isCancelled = false

    setLoading(true)
    setError(null)

    fetchStudentSchedule(normalizedGroupNumber)
      .then((data) => {
        if (isCancelled) return

        setWeek(data)
        setSchedule(data.days)
        setSelectedDate((currentSelectedDate) => {
          if (
            data.days.some((day) => day.date === currentSelectedDate) ||
            data.days.length === 0
          ) {
            return currentSelectedDate
          }

          return data.days[0]?.date ?? currentSelectedDate
        })

        setLoading(false)
      })
      .catch(() => {
        if (isCancelled) return

        setWeek(null)
        clearSchedule()
        setError('Не удалось загрузить расписание.')
        setLoading(false)
      })

    return () => {
      isCancelled = true
    }
  }, [
    normalizedGroupNumber,
    reloadToken,
    clearSchedule,
    setError,
    setLoading,
    setSchedule,
  ])

  const todayKey = toDateKey(new Date())

  const { currentId, nextId } = useMemo(
    () =>
      findCurrentAndNextLesson(
        selectedDate,
        lessonsForSelectedDate,
        todayKey,
      ),
    [lessonsForSelectedDate, selectedDate, todayKey],
  )

  const handleRetry = () => {
    setReloadToken((token) => token + 1)
  }

  const handleSelectDate = (date: string) => {
    setSelectedDate(date)
  }

  const hasLessons = lessonsForSelectedDate.length > 0
  const calendarDays = week?.days ?? []

  return (
    <div className="planner-page">
      <div className="schedule-inner">
        <header className="schedule-header">
          <div>
            <h1 className="planner-title">Расписание</h1>
            <p className="planner-subtitle">
              Смотрите пары на выбранный день и текущую
              неделю.
            </p>
          </div>
        </header>

        {calendarDays.length > 0 && (
          <CalendarStrip
            days={calendarDays}
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
          />
        )}

        {isLoading && (
          <div className="schedule-skeleton-list">
            <div className="schedule-skeleton-card" />
            <div className="schedule-skeleton-card" />
          </div>
        )}

        {!isLoading && error && (
          <div className="schedule-error-card">
            <p className="schedule-error-text">{error}</p>
            {normalizedGroupNumber && (
              <button
                type="button"
                className="schedule-retry-button"
                onClick={handleRetry}
              >
                Повторить попытку
              </button>
            )}
          </div>
        )}

        {!isLoading && !error && (
          <section className="schedule-lessons-section">
            <h2 className="schedule-section-title">
              {selectedDate === todayKey
                ? 'Занятия на сегодня'
                : 'Занятия на выбранный день'}
            </h2>

            {hasLessons ? (
              <div className="schedule-lessons-list">
                {lessonsForSelectedDate.map((lesson) => (
                  <LessonCard
                    key={lesson.id}
                    lesson={lesson}
                    isCurrent={lesson.id === currentId}
                    isNext={lesson.id === nextId}
                  />
                ))}
              </div>
            ) : (
              <div className="schedule-empty-card">
                <h3 className="schedule-empty-title">
                  Пар нет
                </h3>
                <p className="schedule-empty-subtitle">
                  На этот день занятий не запланировано.
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
