import {
  startTransition,
  useState,
} from 'react'
import { Search } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useNavigate } from 'react-router-dom'
import {
  fetchFreeAuditories,
  type FreeAuditoriesResponse,
} from '../api/auditories'
import { getApiErrorMessage } from '../api/client'
import { searchTeachers, type Employee } from '../api/employees'
import { FreeAuditoriesResults } from '../components/university/FreeAuditoriesResults'
import { TeacherResults } from '../components/university/TeacherResults'
import { useAsyncResource } from '../hooks/useAsyncResource'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useScheduleStore } from '../store/scheduleStore'
import { useUserStore } from '../store/userStore'

type SearchMode = 'teachers' | 'freeRooms'

const EMPTY_TEACHERS: Employee[] = []
const SEARCH_MODE_CONFIG: Record<
  SearchMode,
  {
    placeholder: string
    hint: string
    minimumLength: number
  }
> = {
  teachers: {
    placeholder: 'Например, Петров И.И. или Петров',
    hint: 'Введите 2 символа для поиска преподавателя по ФИО.',
    minimumLength: 2,
  },
  freeRooms: {
    placeholder: 'Например, 303, 5к или лаборатория',
    hint: 'Введите 1 символ. Можно искать аудитории и сразу видеть, свободны они сейчас или заняты.',
    minimumLength: 1,
  },
}

export const UniversityPage = () => {
  const navigate = useNavigate()
  const { role, groupNumber, urlId, employeeId, fullName } = useUserStore(
    useShallow((state) => ({
      role: state.role,
      groupNumber: state.groupNumber,
      urlId: state.urlId,
      employeeId: state.employeeId,
      fullName: state.fullName,
    })),
  )
  const setPreviewTeacher = useScheduleStore(
    (state) => state.setPreviewTeacher,
  )

  const [mode, setMode] = useState<SearchMode>('teachers')
  const [query, setQuery] = useState('')

  const debouncedQuery = useDebouncedValue(query.trim(), 180)
  const searchConfig = SEARCH_MODE_CONFIG[mode]

  const normalizedGroupNumber = groupNumber.trim()
  const normalizedTeacherUrlId = urlId.trim()
  const normalizedTeacherEmployeeId = employeeId.trim()
  const hasProfileIdentity =
    role === 'teacher'
      ? normalizedTeacherUrlId.length > 0
      : normalizedGroupNumber.length > 0

  const hasTeacherQuery =
    mode === 'teachers' &&
    debouncedQuery.length >= SEARCH_MODE_CONFIG.teachers.minimumLength
  const hasFreeRoomQuery =
    mode === 'freeRooms' &&
    debouncedQuery.length >= SEARCH_MODE_CONFIG.freeRooms.minimumLength

  const teacherResource = useAsyncResource<Employee[]>({
    enabled: hasTeacherQuery,
    requestKey: hasTeacherQuery ? `teachers:${debouncedQuery}` : null,
    initialData: EMPTY_TEACHERS,
    load: (signal) => searchTeachers(debouncedQuery, signal),
    getErrorMessage: (requestError) =>
      getApiErrorMessage(
        requestError,
        'Не удалось загрузить преподавателей. Попробуйте ещё раз.',
      ),
  })

  const freeAuditoriesResource = useAsyncResource<FreeAuditoriesResponse>({
    enabled: hasProfileIdentity && hasFreeRoomQuery,
    requestKey:
      hasProfileIdentity && hasFreeRoomQuery && role
        ? [
            'free-rooms',
            role,
            debouncedQuery,
            role === 'teacher'
              ? normalizedTeacherUrlId
              : normalizedGroupNumber,
          ].join(':')
        : null,
    initialData: {
      generatedAt: '',
      items: [],
    },
    load: (signal) =>
      fetchFreeAuditories(
        {
          role: role ?? 'student',
          query: debouncedQuery,
          groupNumber: normalizedGroupNumber,
          teacherUrlId: normalizedTeacherUrlId,
          teacherEmployeeId: normalizedTeacherEmployeeId,
        },
        signal,
      ),
    getErrorMessage: (requestError) =>
      getApiErrorMessage(
        requestError,
        'Не удалось загрузить аудитории. Попробуйте ещё раз.',
      ),
  })

  const identityLabel =
    role === 'teacher'
      ? fullName.trim() || 'Профиль преподавателя'
      : normalizedGroupNumber
        ? `Группа ${normalizedGroupNumber}`
        : 'Группа не указана'

  return (
    <div className="planner-page">
      <div className="univer-inner univer-inner--modern">
        <header className="univer-header">
          <div>
            <span className="univer-kicker">Поиск университета</span>
            <h1 className="planner-title">ВУЗ</h1>
            <p className="planner-subtitle">
              {role === 'teacher'
                ? 'Ищите преподавателей и аудитории по данным из вашего профиля.'
                : 'Ищите преподавателей и аудитории по номеру вашей группы.'}
            </p>
          </div>

          <div className="univer-identity-card">
            <span className="univer-identity-label">Текущий профиль</span>
            <strong className="univer-identity-value">{identityLabel}</strong>
          </div>
        </header>

        <div className="univer-mode-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'teachers'}
            className={`univer-mode-tab${
              mode === 'teachers' ? ' univer-mode-tab--active' : ''
            }`}
            onClick={() => {
              if (mode === 'teachers') {
                return
              }

              startTransition(() => {
                setMode('teachers')
                setQuery('')
              })
            }}
          >
            Преподаватели
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={mode === 'freeRooms'}
            className={`univer-mode-tab${
              mode === 'freeRooms' ? ' univer-mode-tab--active' : ''
            }`}
            onClick={() => {
              if (mode === 'freeRooms') {
                return
              }

              startTransition(() => {
                setMode('freeRooms')
                setQuery('')
              })
            }}
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
            onSelectTeacher={(teacher) => {
              setPreviewTeacher(teacher)
              navigate('/app/schedule')
            }}
          />
        ) : (
          <FreeAuditoriesResults
            hasProfileIdentity={hasProfileIdentity}
            hasQuery={hasFreeRoomQuery}
            isLoading={freeAuditoriesResource.isLoading}
            error={freeAuditoriesResource.error}
            items={freeAuditoriesResource.data.items}
            generatedAt={freeAuditoriesResource.data.generatedAt}
            onRetry={freeAuditoriesResource.reload}
          />
        )}
      </div>
    </div>
  )
}
