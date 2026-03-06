import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { searchTeachers, type Employee } from '../api/employees'
import { searchAuditories, type Auditory } from '../api/auditories'
import { getApiErrorMessage } from '../api/client'
import {
  fetchStudentSchedule,
  type WeekSchedule,
} from '../api/schedule'
import { useUserStore } from '../store/userStore'
import type { Lesson } from '../store/scheduleStore'
import {
  buildDateTime,
  parseDateKey,
  toDateKey,
} from '../utils/date'

type SearchMode = 'teachers' | 'auditories'

type TeacherSearchState = {
  requestKey: string | null
  results: Employee[]
  error: string | null
}

type AuditorySearchState = {
  requestKey: string | null
  results: Auditory[]
  error: string | null
}

type RoomScheduleState = {
  requestKey: string | null
  data: WeekSchedule | null
  error: string | null
}

type AuditoryUsage = {
  date: string
  lesson: Lesson
}

const EMPTY_TEACHERS: Employee[] = []
const EMPTY_AUDITORIES: Auditory[] = []
const TEACHER_QUERY_MIN_LENGTH = 2
const AUDITORY_QUERY_MIN_LENGTH = 1

const getInitials = (fullName: string) => {
  const parts = fullName
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)

  if (!parts.length) return ''

  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase()
  }

  return (parts[0]![0] + parts[1]![0]).toUpperCase()
}

const normalizeRoomToken = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[.,]/g, '')
    .replace(/корпус/g, 'к')

const getAuditoryTokens = (auditory: Auditory) => {
  const buildingDigits = auditory.building?.match(/\d+/)?.[0] ?? ''
  const tokens = [
    auditory.fullName,
    `${auditory.name}-${auditory.building ?? ''}`,
    buildingDigits ? `${auditory.name}-${buildingDigits}к` : auditory.name,
    auditory.name,
  ]

  return tokens
    .map(normalizeRoomToken)
    .filter(Boolean)
}

const lessonMatchesAuditory = (
  room: string | undefined,
  auditory: Auditory,
) => {
  if (!room) {
    return false
  }

  const roomTokens = room
    .split(',')
    .map((item) => normalizeRoomToken(item))
    .filter(Boolean)
  const auditoryTokens = getAuditoryTokens(auditory)

  return roomTokens.some((roomToken) =>
    auditoryTokens.some(
      (auditoryToken) =>
        roomToken === auditoryToken ||
        roomToken.includes(auditoryToken) ||
        auditoryToken.includes(roomToken),
    ),
  )
}

const collectAuditoryUsage = (
  auditory: Auditory,
  weekSchedule: WeekSchedule | null,
) => {
  if (!weekSchedule) {
    return []
  }

  return weekSchedule.days
    .flatMap((day) =>
      day.lessons
        .filter((lesson) =>
          lessonMatchesAuditory(lesson.room, auditory),
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

const formatDateLabel = (dateKey: string) => {
  const parsed = parseDateKey(dateKey)

  if (!parsed) {
    return dateKey
  }

  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(parsed)
}

const describeAuditoryStatus = (usage: AuditoryUsage[]) => {
  const todayKey = toDateKey(new Date())
  const now = new Date()

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

export const UniversityPage = () => {
  const groupNumber = useUserStore((state) => state.groupNumber)
  const normalizedGroupNumber = groupNumber?.trim() ?? ''

  const [mode, setMode] = useState<SearchMode>('teachers')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [teacherReloadToken, setTeacherReloadToken] = useState(0)
  const [auditoryReloadToken, setAuditoryReloadToken] = useState(0)
  const [scheduleReloadToken, setScheduleReloadToken] = useState(0)
  const [teacherState, setTeacherState] = useState<TeacherSearchState>({
    requestKey: null,
    results: [],
    error: null,
  })
  const [auditoryState, setAuditoryState] =
    useState<AuditorySearchState>({
      requestKey: null,
      results: [],
      error: null,
    })
  const [scheduleState, setScheduleState] =
    useState<RoomScheduleState>({
      requestKey: null,
      data: null,
      error: null,
    })

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
    }, 350)

    return () => {
      window.clearTimeout(handle)
    }
  }, [query])

  useEffect(() => {
    const requestKey =
      mode === 'teachers' &&
      debouncedQuery.length >= TEACHER_QUERY_MIN_LENGTH
        ? `${debouncedQuery}:${teacherReloadToken}`
        : null

    if (!requestKey) {
      return
    }

    let isCancelled = false

    void searchTeachers(debouncedQuery)
      .then((results) => {
        if (isCancelled) return

        setTeacherState({
          requestKey,
          results,
          error: null,
        })
      })
      .catch((error) => {
        if (isCancelled) return

        setTeacherState({
          requestKey,
          results: [],
          error: getApiErrorMessage(
            error,
            'Не удалось загрузить список преподавателей. Попробуйте ещё раз.',
          ),
        })
      })

    return () => {
      isCancelled = true
    }
  }, [debouncedQuery, mode, teacherReloadToken])

  useEffect(() => {
    const requestKey =
      mode === 'auditories' &&
      debouncedQuery.length >= AUDITORY_QUERY_MIN_LENGTH
        ? `${debouncedQuery}:${auditoryReloadToken}`
        : null

    if (!requestKey) {
      return
    }

    let isCancelled = false

    void searchAuditories(debouncedQuery)
      .then((results) => {
        if (isCancelled) return

        setAuditoryState({
          requestKey,
          results,
          error: null,
        })
      })
      .catch((error) => {
        if (isCancelled) return

        setAuditoryState({
          requestKey,
          results: [],
          error: getApiErrorMessage(
            error,
            'Не удалось загрузить аудитории. Попробуйте ещё раз.',
          ),
        })
      })

    return () => {
      isCancelled = true
    }
  }, [auditoryReloadToken, debouncedQuery, mode])

  const scheduleRequestKey = normalizedGroupNumber
    ? `${normalizedGroupNumber}:${scheduleReloadToken}`
    : null

  useEffect(() => {
    if (!scheduleRequestKey) {
      return
    }

    let isCancelled = false

    void fetchStudentSchedule(normalizedGroupNumber)
      .then((data) => {
        if (isCancelled) return

        setScheduleState({
          requestKey: scheduleRequestKey,
          data,
          error: null,
        })
      })
      .catch((error) => {
        if (isCancelled) return

        setScheduleState({
          requestKey: scheduleRequestKey,
          data: null,
          error: getApiErrorMessage(
            error,
            'Не удалось загрузить расписание группы для аудиторий.',
          ),
        })
      })

    return () => {
      isCancelled = true
    }
  }, [normalizedGroupNumber, scheduleRequestKey])

  const teacherRequestKey =
    mode === 'teachers' &&
    debouncedQuery.length >= TEACHER_QUERY_MIN_LENGTH
      ? `${debouncedQuery}:${teacherReloadToken}`
      : null
  const teacherResolved =
    teacherState.requestKey === teacherRequestKey
  const teacherResults =
    teacherRequestKey && teacherResolved
      ? teacherState.results
      : EMPTY_TEACHERS
  const teacherError =
    teacherRequestKey && teacherResolved ? teacherState.error : null
  const teacherLoading = !!teacherRequestKey && !teacherResolved

  const auditoryRequestKey =
    mode === 'auditories' &&
    debouncedQuery.length >= AUDITORY_QUERY_MIN_LENGTH
      ? `${debouncedQuery}:${auditoryReloadToken}`
      : null
  const auditoryResolved =
    auditoryState.requestKey === auditoryRequestKey
  const auditoryResults =
    auditoryRequestKey && auditoryResolved
      ? auditoryState.results
      : EMPTY_AUDITORIES
  const auditoryError =
    auditoryRequestKey && auditoryResolved
      ? auditoryState.error
      : null
  const auditoryLoading = !!auditoryRequestKey && !auditoryResolved

  const hasGroup = normalizedGroupNumber.length > 0
  const scheduleResolved =
    scheduleState.requestKey === scheduleRequestKey
  const weekSchedule =
    hasGroup && scheduleResolved ? scheduleState.data : null
  const scheduleError =
    hasGroup && scheduleResolved ? scheduleState.error : null
  const scheduleLoading = hasGroup && !scheduleResolved

  const auditoryUsage = useMemo(() => {
    if (!weekSchedule) {
      return new Map<string, AuditoryUsage[]>()
    }

    return new Map(
      auditoryResults.map((auditory) => [
        auditory.id,
        collectAuditoryUsage(auditory, weekSchedule),
      ]),
    )
  }, [auditoryResults, weekSchedule])

  const handleModeChange = (nextMode: SearchMode) => {
    if (nextMode === mode) {
      return
    }

    setMode(nextMode)
    setQuery('')
    setDebouncedQuery('')
  }

  const handleTeacherRetry = () => {
    setTeacherReloadToken((value) => value + 1)
  }

  const handleAuditoryRetry = () => {
    setAuditoryReloadToken((value) => value + 1)
  }

  const handleScheduleRetry = () => {
    setScheduleReloadToken((value) => value + 1)
  }

  const hasTeacherQuery =
    mode === 'teachers' &&
    debouncedQuery.length >= TEACHER_QUERY_MIN_LENGTH
  const hasAuditoryQuery =
    mode === 'auditories' &&
    debouncedQuery.length >= AUDITORY_QUERY_MIN_LENGTH

  return (
    <div className="planner-page">
      <div className="univer-inner">
        <header className="univer-header">
          <div>
            <h1 className="planner-title">Универ</h1>
            <p className="planner-subtitle">
              Ищите преподавателей и проверяйте аудитории по
              вашему расписанию.
            </p>
          </div>
        </header>

        <div className="univer-mode-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'teachers'}
            className={`univer-mode-tab${
              mode === 'teachers'
                ? ' univer-mode-tab--active'
                : ''
            }`}
            onClick={() => handleModeChange('teachers')}
          >
            Преподаватели
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'auditories'}
            className={`univer-mode-tab${
              mode === 'auditories'
                ? ' univer-mode-tab--active'
                : ''
            }`}
            onClick={() => handleModeChange('auditories')}
          >
            Аудитории
          </button>
        </div>

        <section className="univer-search-section">
          <div className="univer-search-input-wrapper">
            <span className="univer-search-icon" aria-hidden="true">
              <Search size={16} />
            </span>
            <input
              className="univer-search-input"
              type="search"
              placeholder={
                mode === 'teachers'
                  ? 'Например, Иванов или кафедра СиСИ'
                  : 'Например, 514 или 5 к.'
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <p className="univer-search-hint">
            {mode === 'teachers'
              ? 'Введите минимум 2 символа, чтобы начать поиск.'
              : 'Введите номер аудитории или корпус. Занятость считается по вашей группе.'}
          </p>
        </section>

        {mode === 'teachers' && teacherLoading && (
          <div className="univer-skeleton-list">
            <div className="univer-skeleton-card" />
            <div className="univer-skeleton-card" />
          </div>
        )}

        {mode === 'teachers' &&
          !teacherLoading &&
          hasTeacherQuery &&
          teacherError && (
            <div className="univer-error-card">
              <p className="univer-error-text">{teacherError}</p>
              <button
                type="button"
                className="univer-retry-button"
                onClick={handleTeacherRetry}
              >
                Повторить попытку
              </button>
            </div>
          )}

        {mode === 'teachers' &&
          !teacherLoading &&
          !teacherError && (
            <section className="univer-results-section">
              {hasTeacherQuery ? (
                teacherResults.length > 0 ? (
                  <div className="univer-results-list">
                    {teacherResults.map((employee) => (
                      <article
                        key={employee.id}
                        className="univer-teacher-card"
                      >
                        <div className="univer-teacher-avatar">
                          {employee.avatarUrl ? (
                            <img
                              src={employee.avatarUrl}
                              alt={`Фото ${employee.fullName}`}
                            />
                          ) : (
                            <span className="univer-teacher-initials">
                              {getInitials(employee.fullName)}
                            </span>
                          )}
                        </div>
                        <div className="univer-teacher-content">
                          <h3 className="univer-teacher-name">
                            {employee.fullName}
                          </h3>
                          <div className="univer-teacher-meta">
                            {employee.position && (
                              <span className="univer-teacher-text">
                                {employee.position}
                              </span>
                            )}
                            {employee.department && (
                              <span className="univer-teacher-pill">
                                {employee.department}
                              </span>
                            )}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="univer-empty-card">
                    <h3 className="univer-empty-title">
                      Ничего не найдено
                    </h3>
                    <p className="univer-empty-subtitle">
                      Попробуйте изменить запрос или проверить
                      написание фамилии.
                    </p>
                  </div>
                )
              ) : (
                <div className="univer-helper-card">
                  <h3 className="univer-helper-title">
                    Начните с поиска
                  </h3>
                  <p className="univer-helper-subtitle">
                    Введите фамилию или часть названия
                    кафедры, чтобы увидеть список
                    преподавателей.
                  </p>
                </div>
              )}
            </section>
          )}

        {mode === 'auditories' && scheduleError && (
          <div className="univer-error-card">
            <p className="univer-error-text">{scheduleError}</p>
            <button
              type="button"
              className="univer-retry-button"
              onClick={handleScheduleRetry}
            >
              Перезагрузить расписание
            </button>
          </div>
        )}

        {mode === 'auditories' && auditoryLoading && (
          <div className="univer-skeleton-list">
            <div className="univer-skeleton-card" />
            <div className="univer-skeleton-card" />
          </div>
        )}

        {mode === 'auditories' &&
          !auditoryLoading &&
          hasAuditoryQuery &&
          auditoryError && (
            <div className="univer-error-card">
              <p className="univer-error-text">{auditoryError}</p>
              <button
                type="button"
                className="univer-retry-button"
                onClick={handleAuditoryRetry}
              >
                Повторить попытку
              </button>
            </div>
          )}

        {mode === 'auditories' &&
          !auditoryLoading &&
          !auditoryError && (
            <section className="univer-results-section">
              {!hasGroup && (
                <div className="univer-helper-card">
                  <h3 className="univer-helper-title">
                    Добавьте учебную группу
                  </h3>
                  <p className="univer-helper-subtitle">
                    Тогда мы сможем показать занятость
                    аудиторий по вашему расписанию.
                  </p>
                </div>
              )}

              {hasAuditoryQuery ? (
                auditoryResults.length > 0 ? (
                  <div className="univer-room-list">
                    {auditoryResults.map((auditory) => {
                      const usage =
                        auditoryUsage.get(auditory.id) ?? []
                      const { current, next } =
                        describeAuditoryStatus(usage)

                      return (
                        <article
                          key={auditory.id}
                          className="univer-room-card"
                        >
                          <div className="univer-room-header">
                            <div>
                              <h3 className="univer-room-title">
                                {auditory.fullName}
                              </h3>
                              <p className="univer-room-subtitle">
                                {auditory.type ?? 'Аудитория'}
                                {auditory.department
                                  ? ` · ${auditory.department}`
                                  : ''}
                              </p>
                            </div>

                            <span
                              className={`univer-room-status${
                                !hasGroup || scheduleLoading || scheduleError
                                  ? ' univer-room-status--idle'
                                  : current
                                    ? ' univer-room-status--busy'
                                    : ' univer-room-status--free'
                              }`}
                            >
                              {!hasGroup
                                ? 'Нужна группа'
                                : scheduleLoading
                                  ? 'Загружаем'
                                  : scheduleError
                                    ? 'Нет данных'
                                    : current
                                      ? 'Занята сейчас'
                                      : 'Свободна сейчас'}
                            </span>
                          </div>

                          <div className="univer-room-meta">
                            {auditory.typeAbbrev && (
                              <span className="univer-teacher-pill">
                                {auditory.typeAbbrev}
                              </span>
                            )}
                            {auditory.capacity != null && (
                              <span className="univer-teacher-pill">
                                {auditory.capacity} мест
                              </span>
                            )}
                            {auditory.note && (
                              <span className="univer-teacher-text">
                                {auditory.note}
                              </span>
                            )}
                          </div>

                          <div className="univer-room-usage">
                            {!hasGroup ? (
                              <p className="univer-room-text">
                                Чтобы видеть занятость, добавьте
                                группу в настройках.
                              </p>
                            ) : scheduleLoading ? (
                              <p className="univer-room-text">
                                Загружаем расписание вашей группы.
                              </p>
                            ) : usage.length > 0 ? (
                              <>
                                <p className="univer-room-text">
                                  {current
                                    ? `Сейчас: ${current.lesson.subject}, ${current.lesson.startTime}-${current.lesson.endTime}`
                                    : next
                                      ? `Следующая пара: ${formatDateLabel(next.date)}, ${next.lesson.startTime}-${next.lesson.endTime}`
                                      : 'На ближайшей неделе по вашему расписанию аудитория свободна.'}
                                </p>

                                <div className="univer-room-slots">
                                  {usage.slice(0, 6).map((item) => (
                                    <div
                                      key={`${auditory.id}-${item.date}-${item.lesson.id}`}
                                      className="univer-room-slot"
                                    >
                                      <span className="univer-room-slot-date">
                                        {formatDateLabel(item.date)}
                                      </span>
                                      <span className="univer-room-slot-time">
                                        {item.lesson.startTime}-
                                        {item.lesson.endTime}
                                      </span>
                                      <span className="univer-room-slot-subject">
                                        {item.lesson.subject}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </>
                            ) : (
                              <p className="univer-room-text">
                                В расписании вашей группы на текущей
                                неделе эта аудитория не используется.
                              </p>
                            )}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  <div className="univer-empty-card">
                    <h3 className="univer-empty-title">
                      Аудитории не найдены
                    </h3>
                    <p className="univer-empty-subtitle">
                      Попробуйте ввести номер аудитории или корпус
                      иначе.
                    </p>
                  </div>
                )
              ) : (
                <div className="univer-helper-card">
                  <h3 className="univer-helper-title">
                    Найдите аудиторию
                  </h3>
                  <p className="univer-helper-subtitle">
                    Можно искать по номеру аудитории или по
                    корпусу, а затем смотреть её занятость по
                    расписанию вашей группы.
                  </p>
                </div>
              )}
            </section>
          )}
      </div>
    </div>
  )
}
