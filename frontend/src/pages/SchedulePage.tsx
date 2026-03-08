import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import {
  fetchSchedule,
  type ScheduleResponse,
  type ScheduleViewMode,
} from '../api/schedule'
import { getApiErrorMessage } from '../api/client'
import {
  LessonCard,
  type LessonCardStatus,
} from '../components/schedule/LessonCard'
import { useAsyncResource } from '../hooks/useAsyncResource'
import { useScheduleStore, type Lesson } from '../store/scheduleStore'
import { useUserStore } from '../store/userStore'
import { buildDateTime, parseDateKey, toDateKey } from '../utils/date'

const VIEW_OPTIONS: Array<{
  value: ScheduleViewMode
  label: string
}> = [
  { value: 'day', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
]

const dayFormatter = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

const rangeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
})

type ScheduleDayView = {
  date: string
  lessons: Array<
    Lesson & {
      status: LessonCardStatus
    }
  >
}

const LESSON_COUNT_LABELS: Record<number, string> = {
  1: 'пара',
  2: 'пары',
  3: 'пары',
  4: 'пары',
}

const shiftDateKey = (
  dateKey: string,
  view: ScheduleViewMode,
  direction: -1 | 1,
) => {
  const parsed = parseDateKey(dateKey) ?? new Date()
  const nextDate = new Date(parsed)

  if (view === 'day') {
    nextDate.setDate(nextDate.getDate() + direction)
  } else if (view === 'week') {
    nextDate.setDate(nextDate.getDate() + direction * 7)
  } else {
    nextDate.setMonth(nextDate.getMonth() + direction)
  }

  return toDateKey(nextDate)
}

const formatScheduleDate = (dateKey: string) => {
  const parsed = parseDateKey(dateKey)
  if (!parsed) {
    return dateKey
  }

  const formatted = dayFormatter.format(parsed)
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

const formatScheduleRange = (
  rangeStart: string,
  rangeEnd: string,
  view: ScheduleViewMode,
) => {
  if (view === 'day') {
    return formatScheduleDate(rangeStart)
  }

  const start = parseDateKey(rangeStart)
  const end = parseDateKey(rangeEnd)

  if (!start || !end) {
    return `${rangeStart} - ${rangeEnd}`
  }

  return `${rangeFormatter.format(start)} - ${rangeFormatter.format(end)}`
}

const getLessonCountLabel = (count: number) => {
  const remainder100 = count % 100
  if (remainder100 >= 11 && remainder100 <= 14) {
    return 'пар'
  }

  return LESSON_COUNT_LABELS[count % 10] ?? 'пар'
}

const getLessonStatus = (
  lesson: Lesson,
  now: Date,
): LessonCardStatus => {
  const start = buildDateTime(lesson.date, lesson.startTime)
  const end = buildDateTime(lesson.date, lesson.endTime)

  if (!start || !end) {
    return 'upcoming'
  }

  if (now > end) {
    return 'past'
  }

  if (now >= start && now <= end) {
    return 'current'
  }

  return 'upcoming'
}

export const SchedulePage = () => {
  const { role, groupNumber, urlId, employeeId, fullName } = useUserStore(
    useShallow((state) => ({
      role: state.role,
      groupNumber: state.groupNumber,
      urlId: state.urlId,
      employeeId: state.employeeId,
      fullName: state.fullName,
    })),
  )
  const { setSchedule, clearSchedule } = useScheduleStore(
    useShallow((state) => ({
      setSchedule: state.setSchedule,
      clearSchedule: state.clearSchedule,
    })),
  )

  const [view, setView] = useState<ScheduleViewMode>('week')
  const [referenceDate, setReferenceDate] = useState(() =>
    toDateKey(new Date()),
  )

  const todayKey = toDateKey(new Date())
  const normalizedGroupNumber = groupNumber.trim()
  const normalizedTeacherUrlId = urlId.trim()
  const normalizedTeacherEmployeeId = employeeId.trim()
  const hasIdentity =
    role === 'teacher'
      ? normalizedTeacherUrlId.length > 0
      : normalizedGroupNumber.length > 0

  const requestKey =
    role && hasIdentity
      ? [
          role,
          role === 'teacher'
            ? normalizedTeacherUrlId
            : normalizedGroupNumber,
          view,
          referenceDate,
        ].join(':')
      : null

  const loadSchedule = useCallback(
    (signal: AbortSignal) => {
      if (!role) {
        return Promise.resolve<ScheduleResponse>({
          view,
          rangeStart: referenceDate,
          rangeEnd: referenceDate,
          days: [],
        })
      }

      return fetchSchedule(
        {
          role,
          date: referenceDate,
          view,
          groupNumber: normalizedGroupNumber,
          teacherUrlId: normalizedTeacherUrlId,
          teacherEmployeeId: normalizedTeacherEmployeeId,
        },
        signal,
      )
    },
    [
      normalizedGroupNumber,
      normalizedTeacherEmployeeId,
      normalizedTeacherUrlId,
      referenceDate,
      role,
      view,
    ],
  )

  const {
    data,
    error,
    isLoading,
    hasResolvedCurrentRequest,
    reload,
  } = useAsyncResource<ScheduleResponse | null>({
    enabled: hasIdentity && role !== null,
    requestKey,
    initialData: null,
    load: loadSchedule,
    getErrorMessage: (requestError) =>
      getApiErrorMessage(
        requestError,
        'Не удалось загрузить расписание. Попробуйте ещё раз.',
      ),
  })

  useEffect(() => {
    if (!hasIdentity) {
      clearSchedule()
    }
  }, [clearSchedule, hasIdentity])

  useEffect(() => {
    if (!hasResolvedCurrentRequest || !data) {
      return
    }

    startTransition(() => {
      setSchedule(data.days)
    })
  }, [data, hasResolvedCurrentRequest, setSchedule])

  const displayError = useMemo(() => {
    if (error) {
      return error
    }

    if (role === 'teacher' && !normalizedTeacherUrlId) {
      return 'Укажите профиль преподавателя в настройках, чтобы смотреть персональное расписание.'
    }

    if (role !== 'teacher' && !normalizedGroupNumber) {
      return 'Добавьте номер группы в настройках, чтобы загрузить расписание.'
    }

    return null
  }, [error, normalizedGroupNumber, normalizedTeacherUrlId, role])

  const rawDays = data?.days
  const visibleDays = useMemo<ScheduleDayView[]>(() => {
    const days = rawDays ?? []
    const now = new Date()
    const mappedDays = days.map((day) => ({
      date: day.date,
      lessons: day.lessons.map((lesson) => ({
        ...lesson,
        status: getLessonStatus(lesson, now),
      })),
    }))

    if (view === 'day') {
      return mappedDays
    }

    return mappedDays.filter((day) => day.lessons.length > 0)
  }, [rawDays, view])

  const hasLessons = visibleDays.some((day) => day.lessons.length > 0)
  const rangeLabel = formatScheduleRange(
    data?.rangeStart ?? referenceDate,
    data?.rangeEnd ?? referenceDate,
    view,
  )
  const identityLabel =
    role === 'teacher'
      ? fullName.trim() || 'Профиль преподавателя'
      : normalizedGroupNumber
        ? `Группа ${normalizedGroupNumber}`
        : 'Группа не указана'

  return (
    <div className="planner-page">
      <div className="schedule-inner schedule-inner--modern">
        <header className="schedule-header schedule-header--modern">
          <div>
            <span className="schedule-kicker">
              {role === 'teacher' ? 'Преподаватель' : 'Студент'}
            </span>
            <h1 className="planner-title">Расписание</h1>
            {role !== 'teacher' && (
              <p className="planner-subtitle">
                Смотрите расписание через backend по номеру вашей учебной группы.
              </p>
            )}
          </div>

          <div className="schedule-identity-card">
            <span className="schedule-identity-label">Профиль</span>
            <strong className="schedule-identity-value">{identityLabel}</strong>
          </div>
        </header>

        <section className="schedule-toolbar">
          <div className="schedule-view-toggle" role="tablist">
            {VIEW_OPTIONS.map((option) => {
              const isActive = view === option.value

              return (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`schedule-view-chip${
                    isActive ? ' schedule-view-chip--active' : ''
                  }`}
                  onClick={() => {
                    if (option.value === view) {
                      return
                    }

                    startTransition(() => {
                      setView(option.value)
                    })
                  }}
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          <div className="schedule-period-bar">
            <button
              type="button"
              className="schedule-period-button"
              onClick={() =>
                setReferenceDate(shiftDateKey(referenceDate, view, -1))
              }
              aria-label="Предыдущий период"
            >
              <ChevronLeft size={18} />
            </button>

            <div className="schedule-period-copy">
              <span className="schedule-period-label">
                {view === 'day'
                  ? 'Выбранный день'
                  : view === 'week'
                    ? 'Текущая неделя'
                    : 'Текущий месяц'}
              </span>
              <strong className="schedule-period-value">{rangeLabel}</strong>
            </div>

            <button
              type="button"
              className="schedule-period-button"
              onClick={() =>
                setReferenceDate(shiftDateKey(referenceDate, view, 1))
              }
              aria-label="Следующий период"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {referenceDate !== todayKey && (
            <button
              type="button"
              className="schedule-today-button"
              onClick={() => setReferenceDate(todayKey)}
            >
              Сегодня
            </button>
          )}
        </section>

        {isLoading && (
          <div className="schedule-skeleton-list">
            <div className="schedule-skeleton-card" />
            <div className="schedule-skeleton-card" />
            <div className="schedule-skeleton-card" />
          </div>
        )}

        {!isLoading && displayError && (
          <div className="schedule-error-card">
            <p className="schedule-error-text">{displayError}</p>
            {hasIdentity && (
              <button
                type="button"
                className="schedule-retry-button"
                onClick={reload}
              >
                Повторить запрос
              </button>
            )}
          </div>
        )}

        {!isLoading && !displayError && (
          <section className="schedule-day-groups">
            {hasLessons ? (
              visibleDays.map((day) => (
                <article key={day.date} className="schedule-day-section">
                  <header className="schedule-day-section-header">
                    <div>
                      <h2 className="schedule-section-title">
                        {formatScheduleDate(day.date)}
                      </h2>
                      <p className="schedule-day-section-subtitle">
                        {day.date === todayKey
                          ? 'Сегодня'
                          : `${day.lessons.length} ${getLessonCountLabel(day.lessons.length)}`}
                      </p>
                    </div>
                  </header>

                  <div className="schedule-lessons-list">
                    {day.lessons.map((lesson) => (
                      <LessonCard
                        key={lesson.id}
                        lesson={lesson}
                        status={lesson.status}
                      />
                    ))}
                  </div>
                </article>
              ))
            ) : (
              <div className="schedule-empty-card">
                <h2 className="schedule-empty-title">Занятий не найдено</h2>
                <p className="schedule-empty-subtitle">
                  На выбранный период пар пока нет.
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
