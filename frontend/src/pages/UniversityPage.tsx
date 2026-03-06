import {
  startTransition,
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
} from 'react'
import { Search } from 'lucide-react'
import { searchAuditories, type Auditory } from '../api/auditories'
import { searchTeachers, type Employee } from '../api/employees'
import { getApiErrorMessage } from '../api/client'
import {
  fetchStudentSchedule,
  type WeekSchedule,
} from '../api/schedule'
import { RoomResults } from '../components/university/RoomResults'
import { TeacherResults } from '../components/university/TeacherResults'
import { useAsyncResource } from '../hooks/useAsyncResource'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useUserStore } from '../store/userStore'
import {
  collectAuditoryUsage,
  describeAuditoryStatus,
  type RoomResult,
} from '../utils/university'

type SearchMode = 'teachers' | 'auditories'

const EMPTY_TEACHERS: Employee[] = []
const EMPTY_AUDITORIES: Auditory[] = []
const TEACHER_QUERY_MIN_LENGTH = 2
const AUDITORY_QUERY_MIN_LENGTH = 1

const SEARCH_MODE_CONFIG = {
  teachers: {
    placeholder: 'Например, Иванов или кафедра СиСИ',
    hint: 'Введите минимум 2 символа, чтобы начать поиск.',
    minimumLength: TEACHER_QUERY_MIN_LENGTH,
  },
  auditories: {
    placeholder: 'Например, 514 или 5 к.',
    hint: 'Введите номер аудитории или корпус. Занятость считается по вашей группе.',
    minimumLength: AUDITORY_QUERY_MIN_LENGTH,
  },
} satisfies Record<
  SearchMode,
  {
    placeholder: string
    hint: string
    minimumLength: number
  }
>

const createTeachersRequestKey = (query: string) =>
  `teachers:${query}`

const createAuditoriesRequestKey = (query: string) =>
  `auditories:${query}`

const createScheduleRequestKey = (groupNumber: string) =>
  `schedule:${groupNumber}`

export const UniversityPage = () => {
  const groupNumber = useUserStore((state) => state.groupNumber)
  const normalizedGroupNumber = groupNumber?.trim() ?? ''

  const [mode, setMode] = useState<SearchMode>('teachers')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const debouncedQuery = useDebouncedValue(
    deferredQuery.trim(),
    350,
  )

  const hasGroup = normalizedGroupNumber.length > 0
  const hasTeacherQuery =
    mode === 'teachers' &&
    debouncedQuery.length >=
      SEARCH_MODE_CONFIG.teachers.minimumLength
  const hasAuditoryQuery =
    mode === 'auditories' &&
    debouncedQuery.length >=
      SEARCH_MODE_CONFIG.auditories.minimumLength

  const loadTeachers = useCallback(
    (signal: AbortSignal) =>
      searchTeachers(debouncedQuery, signal),
    [debouncedQuery],
  )
  const loadAuditories = useCallback(
    (signal: AbortSignal) =>
      searchAuditories(debouncedQuery, signal),
    [debouncedQuery],
  )
  const loadWeekSchedule = useCallback(
    (signal: AbortSignal) =>
      fetchStudentSchedule(normalizedGroupNumber, signal),
    [normalizedGroupNumber],
  )

  const teacherResource = useAsyncResource<Employee[]>({
    enabled: hasTeacherQuery,
    requestKey: hasTeacherQuery
      ? createTeachersRequestKey(debouncedQuery)
      : null,
    initialData: EMPTY_TEACHERS,
    load: loadTeachers,
    getErrorMessage: (error) =>
      getApiErrorMessage(
        error,
        'Не удалось загрузить список преподавателей. Попробуйте ещё раз.',
      ),
  })
  const auditoryResource = useAsyncResource<Auditory[]>({
    enabled: hasAuditoryQuery,
    requestKey: hasAuditoryQuery
      ? createAuditoriesRequestKey(debouncedQuery)
      : null,
    initialData: EMPTY_AUDITORIES,
    load: loadAuditories,
    getErrorMessage: (error) =>
      getApiErrorMessage(
        error,
        'Не удалось загрузить аудитории. Попробуйте ещё раз.',
      ),
  })
  const scheduleResource = useAsyncResource<WeekSchedule | null>({
    enabled: hasGroup,
    requestKey: hasGroup
      ? createScheduleRequestKey(normalizedGroupNumber)
      : null,
    initialData: null,
    load: loadWeekSchedule,
    getErrorMessage: (error) =>
      getApiErrorMessage(
        error,
        'Не удалось загрузить расписание группы для аудиторий.',
      ),
  })

  const roomResults = useMemo<RoomResult[]>(
    () =>
      auditoryResource.data.map((auditory) => {
        const usage = collectAuditoryUsage(
          auditory,
          scheduleResource.data,
        )
        const { current, next } = describeAuditoryStatus(usage)

        return {
          auditory,
          usage,
          current,
          next,
        }
      }),
    [auditoryResource.data, scheduleResource.data],
  )

  const handleModeChange = (nextMode: SearchMode) => {
    if (nextMode === mode) {
      return
    }

    startTransition(() => {
      setMode(nextMode)
      setQuery('')
    })
  }

  const searchConfig = SEARCH_MODE_CONFIG[mode]

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
              placeholder={searchConfig.placeholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <p className="univer-search-hint">{searchConfig.hint}</p>
        </section>

        {mode === 'teachers' ? (
          <TeacherResults
            hasQuery={hasTeacherQuery}
            isLoading={teacherResource.isLoading}
            error={teacherResource.error}
            teachers={teacherResource.data}
            onRetry={teacherResource.reload}
          />
        ) : (
          <RoomResults
            hasGroup={hasGroup}
            hasQuery={hasAuditoryQuery}
            roomResults={roomResults}
            scheduleError={scheduleResource.error}
            isScheduleLoading={scheduleResource.isLoading}
            auditoriesError={auditoryResource.error}
            isAuditoriesLoading={auditoryResource.isLoading}
            onRetrySchedule={scheduleResource.reload}
            onRetryAuditories={auditoryResource.reload}
          />
        )}
      </div>
    </div>
  )
}
