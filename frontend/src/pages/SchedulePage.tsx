import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { fetchStudentSchedule } from '../api/schedule'
import { CalendarStrip } from '../components/schedule/CalendarStrip'
import { LessonCard } from '../components/schedule/LessonCard'
import { useAsyncResource } from '../hooks/useAsyncResource'
import {
  selectLessonsForDate,
  useScheduleStore,
  type Lesson,
} from '../store/scheduleStore'
import { useUserStore } from '../store/userStore'
import { buildDateTime, toDateKey } from '../utils/date'
import { useShallow } from 'zustand/react/shallow'
import type { WeekSchedule } from '../api/schedule'

const findCurrentAndNextLesson = (
  date: string,
  lessons: Lesson[],
  todayKey: string,
): { currentId: string | null; nextId: string | null } => {
  if (!lessons.length || date !== todayKey) {
    return { currentId: null, nextId: null }
  }

  const now = new Date()

  let currentId: string | null = null
  let nextId: string | null = null

  for (const lesson of lessons) {
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
  const { calendarDays, setSchedule, clearSchedule } =
    useScheduleStore(
      useShallow((state) => ({
        calendarDays: state.days,
        setSchedule: state.setSchedule,
        clearSchedule: state.clearSchedule,
      })),
    )

  const [selectedDate, setSelectedDate] = useState<string>(() =>
    toDateKey(new Date()),
  )
  const lessonsSelector = useMemo(
    () => selectLessonsForDate(selectedDate),
    [selectedDate],
  )
  const lessonsForSelectedDate = useScheduleStore(lessonsSelector)
  const hasGroup = normalizedGroupNumber.length > 0
  const requestKey = hasGroup ? normalizedGroupNumber : null
  const loadSchedule = useCallback(
    (signal: AbortSignal) =>
      fetchStudentSchedule(normalizedGroupNumber, signal),
    [normalizedGroupNumber],
  )
  const mapScheduleError = useCallback(
    () => 'Не удалось загрузить расписание.',
    [],
  )
  const {
    data,
    error,
    isLoading,
    reload,
    hasResolvedCurrentRequest,
  } = useAsyncResource<WeekSchedule | null>({
    enabled: hasGroup,
    requestKey,
    initialData: null,
    load: loadSchedule,
    getErrorMessage: mapScheduleError,
  })

  useEffect(() => {
    if (!hasGroup) {
      clearSchedule()
      return
    }

    clearSchedule()
  }, [clearSchedule, hasGroup, requestKey])

  useEffect(() => {
    if (!hasGroup || !hasResolvedCurrentRequest) {
      return
    }

    if (!data) {
      clearSchedule()
      return
    }

    startTransition(() => {
      setSchedule(data.days)
      setSelectedDate((currentSelectedDate) => {
        if (
          data.days.some(
            (day) => day.date === currentSelectedDate,
          ) ||
          data.days.length === 0
        ) {
          return currentSelectedDate
        }

        return data.days[0]?.date ?? currentSelectedDate
      })
    })
  }, [
    clearSchedule,
    data,
    hasGroup,
    hasResolvedCurrentRequest,
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

  const handleSelectDate = (date: string) => {
    setSelectedDate(date)
  }

  const displayError = hasGroup
    ? error
    : 'Добавьте учебную группу в настройках, чтобы видеть расписание.'
  const visibleLessons = hasGroup ? lessonsForSelectedDate : []
  const hasLessons = visibleLessons.length > 0

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

        {!isLoading && displayError && (
          <div className="schedule-error-card">
            <p className="schedule-error-text">{displayError}</p>
            {hasGroup && (
              <button
                type="button"
                className="schedule-retry-button"
                onClick={reload}
              >
                Повторить попытку
              </button>
            )}
          </div>
        )}

        {!isLoading && !displayError && (
          <section className="schedule-lessons-section">
            <h2 className="schedule-section-title">
              {selectedDate === todayKey
                ? 'Занятия на сегодня'
                : 'Занятия на выбранный день'}
            </h2>

            {hasLessons ? (
              <div className="schedule-lessons-list">
                {visibleLessons.map((lesson) => (
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
