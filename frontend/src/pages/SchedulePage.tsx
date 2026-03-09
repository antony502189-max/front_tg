import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import {
  DataRefreshBadge,
  ScheduleLoadingState,
} from '../components/loading/PageLoadingStates'
import { SubgroupToggle } from '../components/user/SubgroupToggle'
import { useAsyncResource } from '../hooks/useAsyncResource'
import { useSubgroupPreference } from '../hooks/useSubgroupPreference'
import { getInitials } from '../utils/university'
import { useScheduleStore, type Lesson } from '../store/scheduleStore'
import { useUserStore } from '../store/userStore'
import { buildDateTime, parseDateKey, toDateKey } from '../utils/date'

const DEFAULT_VIEW_OPTIONS: Array<{
  value: ScheduleViewMode
  label: string
}> = [
  { value: 'day', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
]

const TEACHER_VIEW_OPTIONS: Array<{
  value: ScheduleViewMode
  label: string
}> = [...DEFAULT_VIEW_OPTIONS, { value: 'semester', label: 'Семестр' }]

const dayFormatter = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

const rangeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
})

const weekdayFormatter = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
})

const shortDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
})

type ScheduleLessonView = Lesson & {
  status: LessonCardStatus
}

type ScheduleTimeSlotView = {
  key: string
  lessons: ScheduleLessonView[]
  breakMinutesAfter: number | null
}

type ScheduleDayView = {
  date: string
  lessons: ScheduleLessonView[]
  slots: ScheduleTimeSlotView[]
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
  } else if (view === 'month') {
    nextDate.setMonth(nextDate.getMonth() + direction)
  } else {
    nextDate.setMonth(nextDate.getMonth() + direction * 4)
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

const formatScheduleWeekday = (dateKey: string) => {
  const parsed = parseDateKey(dateKey)
  if (!parsed) {
    return dateKey
  }

  const formatted = weekdayFormatter.format(parsed)
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

const formatScheduleShortDate = (dateKey: string) => {
  const parsed = parseDateKey(dateKey)
  if (!parsed) {
    return dateKey
  }

  return shortDateFormatter.format(parsed)
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

const timeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number)

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes)
  ) {
    return null
  }

  return hours * 60 + minutes
}

const getBreakMinutes = (
  endTime: string,
  nextStartTime: string,
) => {
  const endMinutes = timeToMinutes(endTime)
  const nextStartMinutes = timeToMinutes(nextStartTime)

  if (
    endMinutes === null ||
    nextStartMinutes === null ||
    nextStartMinutes <= endMinutes
  ) {
    return null
  }

  return nextStartMinutes - endMinutes
}

const groupLessonsByTimeSlots = (
  lessons: ScheduleLessonView[],
): ScheduleTimeSlotView[] => {
  const slots: Array<{
    key: string
    startTime: string
    endTime: string
    lessons: ScheduleLessonView[]
  }> = []

  lessons.forEach((lesson, index) => {
    const slotKey = `${lesson.startTime}-${lesson.endTime}`
    const currentSlot = slots[slots.length - 1]

    if (currentSlot && currentSlot.key === slotKey) {
      currentSlot.lessons.push(lesson)
      return
    }

    slots.push({
      key: `${slotKey}-${index}`,
      startTime: lesson.startTime,
      endTime: lesson.endTime,
      lessons: [lesson],
    })
  })

  return slots.map((slot, index) => ({
    key: slot.key,
    lessons: slot.lessons,
    breakMinutesAfter:
      index < slots.length - 1
        ? getBreakMinutes(slot.endTime, slots[index + 1].startTime)
        : null,
  }))
}

const formatBreakLabel = (minutes: number) =>
  minutes === 1 ? '1 минута' : `${minutes} минут`

const getRelativeDayLabel = (dateKey: string, todayKey: string) => {
  if (dateKey === todayKey) {
    return 'Сегодня'
  }

  const today = parseDateKey(todayKey)
  const current = parseDateKey(dateKey)

  if (!today || !current) {
    return null
  }

  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  return toDateKey(tomorrow) === dateKey ? 'Завтра' : null
}

export const SchedulePage = () => {
  const { role, groupNumber, urlId, employeeId, fullName } =
    useUserStore(
      useShallow((state) => ({
        role: state.role,
        groupNumber: state.groupNumber,
        urlId: state.urlId,
        employeeId: state.employeeId,
        fullName: state.fullName,
      })),
    )
  const {
    subgroup,
    isSaving: isSavingSubgroup,
    error: subgroupError,
    setSubgroup,
  } = useSubgroupPreference()
  const {
    setSchedule,
    clearSchedule,
    previewTeacher,
    clearPreviewTeacher,
  } = useScheduleStore(
    useShallow((state) => ({
      setSchedule: state.setSchedule,
      clearSchedule: state.clearSchedule,
      previewTeacher: state.previewTeacher,
      clearPreviewTeacher: state.clearPreviewTeacher,
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
  const previewTeacherUrlId = previewTeacher?.urlId.trim() ?? ''
  const previewTeacherEmployeeId =
    previewTeacher?.employeeId.trim() ?? ''
  const isTeacherPreview = previewTeacherUrlId.length > 0
  const effectiveRole = isTeacherPreview ? 'teacher' : role
  const activeTeacherUrlId = isTeacherPreview
    ? previewTeacherUrlId
    : normalizedTeacherUrlId
  const activeTeacherEmployeeId = isTeacherPreview
    ? previewTeacherEmployeeId
    : normalizedTeacherEmployeeId
  const hasIdentity =
    effectiveRole === 'teacher'
      ? activeTeacherUrlId.length > 0
      : normalizedGroupNumber.length > 0
  const viewOptions =
    effectiveRole === 'teacher'
      ? TEACHER_VIEW_OPTIONS
      : DEFAULT_VIEW_OPTIONS
  const effectiveSubgroup =
    effectiveRole === 'teacher' ? 'all' : subgroup

  const previousPreviewRef = useRef(isTeacherPreview)
  const previousPreviewTeacherIdRef = useRef(activeTeacherUrlId)

  useEffect(() => {
    const enteredPreview =
      isTeacherPreview && !previousPreviewRef.current
    const switchedPreviewTeacher =
      isTeacherPreview &&
      previousPreviewTeacherIdRef.current !== activeTeacherUrlId

    if (enteredPreview || switchedPreviewTeacher) {
      startTransition(() => {
        setReferenceDate(todayKey)
        setView('semester')
      })
    }

    if (
      !isTeacherPreview &&
      previousPreviewRef.current &&
      role === 'student'
    ) {
      startTransition(() => {
        setReferenceDate(todayKey)
        setView('week')
      })
    }

    previousPreviewRef.current = isTeacherPreview
    previousPreviewTeacherIdRef.current = activeTeacherUrlId
  }, [activeTeacherUrlId, isTeacherPreview, role, todayKey])

  useEffect(() => {
    if (
      effectiveRole !== 'teacher' &&
      view === 'semester'
    ) {
      setView('week')
    }
  }, [effectiveRole, view])

  const requestKey =
    effectiveRole && hasIdentity
      ? [
          effectiveRole,
          effectiveRole === 'teacher'
            ? activeTeacherUrlId
            : normalizedGroupNumber,
          activeTeacherEmployeeId,
          effectiveSubgroup,
          view,
          referenceDate,
        ].join(':')
      : null

  const loadSchedule = useCallback(
    (signal: AbortSignal) => {
      if (!effectiveRole) {
        return Promise.resolve<ScheduleResponse>({
          view,
          rangeStart: referenceDate,
          rangeEnd: referenceDate,
          days: [],
        })
      }

      return fetchSchedule(
        {
          role: effectiveRole,
          date: referenceDate,
          view,
          groupNumber: normalizedGroupNumber,
          teacherUrlId: activeTeacherUrlId,
          teacherEmployeeId: activeTeacherEmployeeId,
          subgroup: effectiveSubgroup,
        },
        signal,
      )
    },
    [
      activeTeacherEmployeeId,
      activeTeacherUrlId,
      effectiveRole,
      effectiveSubgroup,
      normalizedGroupNumber,
      referenceDate,
      view,
    ],
  )

  const {
    data,
    error,
    hasData,
    isInitialLoading,
    isRefreshing,
    reload,
    updatedAt,
  } = useAsyncResource<ScheduleResponse | null>({
    enabled: hasIdentity && effectiveRole !== null,
    requestKey,
    initialData: null,
    load: loadSchedule,
    keepPreviousData: true,
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
    if (!data) {
      return
    }

    startTransition(() => {
      setSchedule(data.days)
    })
  }, [data, setSchedule])

  const displayError = useMemo(() => {
    if (error) {
      return error
    }

    if (effectiveRole === 'teacher' && !activeTeacherUrlId) {
      return isTeacherPreview
        ? 'Выберите преподавателя во вкладке ВУЗ, чтобы открыть его расписание.'
        : 'Укажите профиль преподавателя в настройках, чтобы смотреть персональное расписание.'
    }

    if (effectiveRole !== 'teacher' && !normalizedGroupNumber) {
      return 'Добавьте номер группы в настройках, чтобы загрузить расписание.'
    }

    return null
  }, [
    activeTeacherUrlId,
    effectiveRole,
    error,
    isTeacherPreview,
    normalizedGroupNumber,
  ])
  const blockingError = !hasData ? displayError : null
  const refreshError = hasData ? error : null

  const rawDays = data?.days
  const visibleDays = useMemo<ScheduleDayView[]>(() => {
    const days = rawDays ?? []
    const now = new Date()
    const mappedDays = days.map((day) => {
      const lessons = day.lessons.map((lesson) => ({
        ...lesson,
        status: getLessonStatus(lesson, now),
      }))

      return {
        date: day.date,
        lessons,
        slots: groupLessonsByTimeSlots(lessons),
      }
    })

    if (view === 'day' || view === 'semester') {
      return mappedDays
    }

    return mappedDays.filter((day) => day.lessons.length > 0)
  }, [rawDays, view])

  const rangeLabel = formatScheduleRange(
    data?.rangeStart ?? referenceDate,
    data?.rangeEnd ?? referenceDate,
    view,
  )
  const identityLabel =
    effectiveRole === 'teacher'
      ? previewTeacher?.fullName.trim() ||
        fullName.trim() ||
        'Профиль преподавателя'
      : normalizedGroupNumber
        ? `Группа ${normalizedGroupNumber}`
        : 'Группа не указана'
  const subtitle =
    effectiveRole === 'teacher'
      ? isTeacherPreview
        ? 'Просматриваете расписание преподавателя, выбранного во вкладке ВУЗ.'
        : 'Смотрите персональное расписание преподавателя по urlId.'
      : 'Смотрите расписание по номеру вашей учебной группы.'
  const subgroupLabel =
    effectiveSubgroup === 'all'
      ? 'Все пары'
      : `${effectiveSubgroup}-я подгруппа`
  const refreshBadge = isRefreshing ? (
    <DataRefreshBadge
      label="Обновляем расписание"
      updatedAt={updatedAt}
      tone="loading"
    />
  ) : refreshError ? (
    <DataRefreshBadge
      label="Показаны сохраненные данные"
      updatedAt={updatedAt}
      tone="warning"
    />
  ) : null

  return (
    <div className="planner-page">
      <div className="schedule-inner schedule-inner--modern">
        <header className="schedule-header schedule-header--modern">
          <div>
            <span className="schedule-kicker">
              {effectiveRole === 'teacher' ? 'Преподаватель' : 'Студент'}
            </span>
            <h1 className="planner-title">Расписание</h1>
            <p className="planner-subtitle">{subtitle}</p>
          </div>

          <div className="schedule-identity-card">
            <span className="schedule-identity-label">Профиль</span>
            <strong className="schedule-identity-value">
              {identityLabel}
            </strong>
          </div>
        </header>

        {isTeacherPreview && previewTeacher && (
          <section className="schedule-preview-card">
            <div className="schedule-preview-avatar">
              {previewTeacher.avatarUrl ? (
                <img
                  src={previewTeacher.avatarUrl}
                  alt={`Фото ${previewTeacher.fullName}`}
                />
              ) : (
                <span className="schedule-preview-initials">
                  {getInitials(previewTeacher.fullName)}
                </span>
              )}
            </div>

            <div className="schedule-preview-copy">
              <h2 className="schedule-preview-title">
                {previewTeacher.fullName}
              </h2>
              <p className="schedule-preview-subtitle">
                {previewTeacher.position || 'Преподаватель'}
                {previewTeacher.department
                  ? ` · ${previewTeacher.department}`
                  : ''}
              </p>
            </div>

            <button
              type="button"
              className="schedule-back-button"
              onClick={clearPreviewTeacher}
            >
              К моему расписанию
            </button>
          </section>
        )}

        <section className="schedule-toolbar">
          <div className="schedule-view-toggle" role="tablist">
            {viewOptions.map((option) => {
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

          {effectiveRole !== 'teacher' && (
            <div className="schedule-subgroup-panel">
              <div className="schedule-subgroup-copy">
                <span className="schedule-subgroup-label">Подгруппа</span>
                <strong className="schedule-subgroup-value">
                  {subgroupLabel}
                </strong>
                <p className="schedule-subgroup-text">
                  По умолчанию показываются все пары. Если в одном слоте идут
                  разные занятия, переключитесь на нужную подгруппу.
                </p>
              </div>

              <SubgroupToggle
                value={subgroup}
                onChange={setSubgroup}
                ariaLabel="Быстрый выбор подгруппы в расписании"
                className="schedule-subgroup-toggle"
              />

              <p className="schedule-subgroup-note">
                {isSavingSubgroup
                  ? 'Сохраняем выбор подгруппы…'
                  : 'Переключатель синхронизирован с профилем.'}
              </p>

              {subgroupError && (
                <p className="schedule-subgroup-error">{subgroupError}</p>
              )}
            </div>
          )}

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
                    : view === 'month'
                      ? 'Текущий месяц'
                      : 'До конца семестра'}
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

        {isInitialLoading && <ScheduleLoadingState />}

        {refreshBadge && (
          <div className="page-refresh-indicator-slot">
            {refreshBadge}
          </div>
        )}

        {blockingError && !isInitialLoading && (
          <div className="schedule-error-card">
            <p className="schedule-error-text">{blockingError}</p>
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

        {hasData && !blockingError && (
          <section className="schedule-day-groups">
            {visibleDays.length > 0 ? (
              visibleDays.map((day) => {
                const relativeDayLabel = getRelativeDayLabel(
                  day.date,
                  todayKey,
                )
                const lessonsLabel =
                  day.lessons.length > 0
                    ? `${day.lessons.length} ${getLessonCountLabel(day.lessons.length)}`
                    : 'Нет занятий'

                return (
                  <article
                    key={day.date}
                    className={`schedule-day-section${
                      relativeDayLabel
                        ? ' schedule-day-section--accent'
                        : ''
                    }`}
                  >
                    <header className="schedule-day-section-header">
                      <h2 className="schedule-section-title schedule-day-title">
                        {formatScheduleWeekday(day.date)}
                      </h2>
                      <p className="schedule-day-section-subtitle">
                        {[
                          relativeDayLabel?.toLowerCase(),
                          formatScheduleShortDate(day.date),
                          lessonsLabel,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </header>

                    {day.lessons.length > 0 ? (
                      <div className="schedule-lessons-list">
                        {day.slots.map((slot) => (
                          <div
                            key={slot.key}
                            className="schedule-slot-group"
                          >
                            {slot.lessons.map((lesson) => (
                              <LessonCard
                                key={lesson.id}
                                lesson={lesson}
                                status={lesson.status}
                              />
                            ))}

                            {slot.breakMinutesAfter !== null && (
                              <div className="schedule-break-label">
                                {formatBreakLabel(slot.breakMinutesAfter)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="schedule-empty-inline">
                        Нет занятий
                      </div>
                    )}
                  </article>
                )
              })
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
