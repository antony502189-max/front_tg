import { useCallback, useMemo } from 'react'
import { Star, Trophy } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import {
  fetchGrades,
  fetchGradesSummary,
  type GradesResponse,
  type GradesSummary,
  type GradesSummaryResponse,
} from '../api/grades'
import {
  fetchOmissions,
  type OmissionsResponse,
} from '../api/omissions'
import { getApiErrorMessage } from '../api/client'
import {
  DataRefreshBadge,
  StudyLoadingState,
} from '../components/loading/PageLoadingStates'
import {
  StudyProgressSection,
  type StudyProgressColumn,
} from '../components/study/StudyProgressSection'
import { useAsyncResource } from '../hooks/useAsyncResource'
import { useUserStore } from '../store/userStore'
import { resolveSessionUserId } from '../telegram/session'
import {
  buildStudyOverview,
  formatMarksLabel,
} from '../utils/study'

const EMPTY_SUBJECTS: GradesResponse['subjects'] = []
const EMPTY_OMISSION_MONTHS: OmissionsResponse['months'] = []
const EMPTY_OMISSION_SUBJECTS: OmissionsResponse['subjects'] = []
const BASE_PROGRESS_MARK_COLUMNS: StudyProgressColumn[] = [
  { key: 'lab', label: 'ЛР' },
  { key: 'practice', label: 'ПЗ' },
  { key: 'lecture', label: 'ЛК' },
]
const OTHER_PROGRESS_MARK_COLUMN = {
  key: 'other' as const,
  label: 'Др.',
}
const IIS_AUTH_ERROR_MARKER = 'авторизоваться в iis'

type SubjectOmissionLookup = {
  exact: Map<string, number>
  abbreviations: Map<string, number | null>
}

const normalizeSubjectKey = (value: string) =>
  value
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[\s().,:;/-]+/g, '')

const tokenizeSubjectName = (value: string) =>
  value
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/i)
    .filter((token) => token.length > 0)

const getSubjectAbbreviationKey = (value: string) => {
  const tokens = tokenizeSubjectName(value)

  if (tokens.length <= 1) {
    return ''
  }

  return tokens.map((token) => token[0]).join('')
}

const buildSubjectOmissionLookup = (
  subjects: OmissionsResponse['subjects'],
): SubjectOmissionLookup => {
  const exact = new Map<string, number>()
  const abbreviations = new Map<string, number | null>()

  for (const subject of subjects) {
    const exactKey = normalizeSubjectKey(subject.subject)
    if (exactKey) {
      exact.set(exactKey, subject.omissionCount)
    }

    const abbreviationKey = getSubjectAbbreviationKey(subject.subject)
    if (!abbreviationKey) {
      continue
    }

    const currentValue = abbreviations.get(abbreviationKey)
    if (currentValue === undefined) {
      abbreviations.set(abbreviationKey, subject.omissionCount)
      continue
    }

    if (currentValue !== subject.omissionCount) {
      abbreviations.set(abbreviationKey, null)
    }
  }

  return {
    exact,
    abbreviations,
  }
}

const resolveSubjectOmissionCount = (
  subjectName: string,
  lookup: SubjectOmissionLookup,
) => {
  const exactValue = lookup.exact.get(normalizeSubjectKey(subjectName))
  if (exactValue !== undefined) {
    return exactValue
  }

  const abbreviationKey = getSubjectAbbreviationKey(subjectName)
  if (!abbreviationKey) {
    return undefined
  }

  const abbreviationValue = lookup.abbreviations.get(abbreviationKey)
  return abbreviationValue === null ? undefined : abbreviationValue
}

const isIisAuthorizationError = (message: string | null) => {
  if (typeof message !== 'string') {
    return false
  }

  const normalized = message.toLocaleLowerCase('ru-RU')
  const result = normalized.includes(IIS_AUTH_ERROR_MARKER)

  // Debug logging
  if (import.meta.env.DEV) {
    console.log('[isIisAuthorizationError]', {
      original: message,
      normalized,
      marker: IIS_AUTH_ERROR_MARKER,
      result,
    })
  }

  return result
}

const StudyMetricValue = ({
  isLoading,
  value,
  className = '',
}: {
  isLoading: boolean
  value: string | number
  className?: string
}) =>
  isLoading ? (
    <span
      className={`app-skeleton study-inline-skeleton ${className}`.trim()}
      aria-hidden="true"
    />
  ) : (
    value
  )

const mergeGradesSummary = (
  gradesSummary: GradesSummary | undefined,
  ratingSummary: GradesSummary | undefined,
): GradesSummary | undefined => {
  const average = ratingSummary?.average ?? gradesSummary?.average
  const position = ratingSummary?.position ?? gradesSummary?.position
  const speciality =
    ratingSummary?.speciality ?? gradesSummary?.speciality

  if (
    average === undefined &&
    position === undefined &&
    speciality === undefined
  ) {
    return undefined
  }

  return {
    ...(average !== undefined ? { average } : {}),
    ...(position !== undefined ? { position } : {}),
    ...(speciality !== undefined ? { speciality } : {}),
  }
}

export const StudyPage = () => {
  const {
    role,
    groupNumber,
    studentCardNumber,
    iisLogin,
    hasIisPassword,
    profileUpdatedAt,
  } = useUserStore(
    useShallow((state) => ({
      role: state.role,
      groupNumber: state.groupNumber,
      studentCardNumber: state.studentCardNumber,
      iisLogin: state.iisLogin,
      hasIisPassword: state.hasIisPassword,
      profileUpdatedAt: state.profileUpdatedAt,
    })),
  )

  const sessionUserId = resolveSessionUserId()
  const normalizedSessionUserId = sessionUserId.trim()
  const normalizedIisLogin = iisLogin.trim()
  const normalizedProfileUpdatedAt = profileUpdatedAt.trim()
  const normalizedStudentCardNumber =
    studentCardNumber.trim() || normalizedIisLogin
  const normalizedGroupNumber = groupNumber.trim()
  const hasStudentCardNumber = normalizedStudentCardNumber.length > 0
  const hasIisCredentials =
    normalizedIisLogin.length > 0 && hasIisPassword
  const canLoadGrades = role === 'student' && hasStudentCardNumber
  const canLoadOmissions =
    role === 'student' &&
    normalizedSessionUserId.length > 0 &&
    hasIisCredentials
  const gradesPersistentCacheKey = canLoadGrades
    ? `grades:${normalizedStudentCardNumber}:${normalizedProfileUpdatedAt || 'v0'}`
    : null
  const gradesSummaryPersistentCacheKey = canLoadGrades
    ? `grades-summary:${normalizedStudentCardNumber}:${normalizedGroupNumber || 'nogroup'}:${normalizedProfileUpdatedAt || 'v0'}`
    : null
  const omissionsPersistentCacheKey = canLoadOmissions
    ? `omissions:${normalizedSessionUserId}:${normalizedIisLogin}:${normalizedProfileUpdatedAt || 'v0'}`
    : null

  const loadGrades = useCallback(
    (
      signal: AbortSignal,
      context: { reloadToken: number },
    ) =>
      fetchGrades(normalizedStudentCardNumber, {
        signal,
        forceRefresh: context.reloadToken > 0,
        refreshToken: String(context.reloadToken),
        telegramUserId: normalizedSessionUserId,
      }),
    [normalizedStudentCardNumber, normalizedSessionUserId],
  )
  const loadGradesSummary = useCallback(
    (
      signal: AbortSignal,
      context: { reloadToken: number },
    ) =>
      fetchGradesSummary(normalizedStudentCardNumber, {
        groupNumber: normalizedGroupNumber,
        forceRefresh: context.reloadToken > 0,
        refreshToken: String(context.reloadToken),
        signal,
        telegramUserId: normalizedSessionUserId,
      }),
    [normalizedGroupNumber, normalizedStudentCardNumber, normalizedSessionUserId],
  )
  const loadOmissions = useCallback(
    (
      signal: AbortSignal,
      context: { reloadToken: number },
    ) =>
      fetchOmissions(normalizedSessionUserId, {
        forceRefresh: context.reloadToken > 0,
        refreshToken: String(context.reloadToken),
        signal,
      }),
    [normalizedSessionUserId],
  )

  const {
    data,
    error,
    hasData,
    isInitialLoading,
    isRefreshing,
    reload,
    updatedAt,
  } = useAsyncResource<GradesResponse | null>({
    enabled: canLoadGrades,
    requestKey: canLoadGrades
      ? normalizedStudentCardNumber
      : null,
    initialData: null,
    load: loadGrades,
    keepPreviousData: true,
    persistentCache: {
      key: gradesPersistentCacheKey,
      maxAgeMs: 30 * 24 * 60 * 60 * 1000,
    },
    getErrorMessage: (requestError) =>
      getApiErrorMessage(
        requestError,
        'Не удалось загрузить оценки по успеваемости.',
      ),
  })
  const canLoadGradesSummary = canLoadGrades
  const {
    data: summaryData,
    error: summaryError,
    hasData: hasSummaryData,
    isInitialLoading: isSummaryInitialLoading,
    isRefreshing: isSummaryRefreshing,
    reload: reloadSummary,
    updatedAt: summaryUpdatedAt,
  } = useAsyncResource<GradesSummaryResponse | null>({
    enabled: canLoadGradesSummary,
    requestKey: canLoadGradesSummary
      ? `summary:${normalizedStudentCardNumber}:${normalizedGroupNumber || 'nogroup'}`
      : null,
    initialData: null,
    load: loadGradesSummary,
    keepPreviousData: true,
    persistentCache: {
      key: gradesSummaryPersistentCacheKey,
      maxAgeMs: 30 * 24 * 60 * 60 * 1000,
    },
    getErrorMessage: (requestError) =>
      getApiErrorMessage(
        requestError,
        'Не удалось обновить рейтинг по успеваемости.',
      ),
  })
  const {
    data: omissionsData,
    error: omissionsError,
    hasData: hasOmissionsData,
    isInitialLoading: isOmissionsInitialLoading,
    isRefreshing: isOmissionsRefreshing,
    reload: reloadOmissions,
    updatedAt: omissionsUpdatedAt,
  } = useAsyncResource<OmissionsResponse | null>({
    enabled: canLoadOmissions,
    requestKey: canLoadOmissions
      ? `omissions:${normalizedSessionUserId}:${normalizedIisLogin}:${hasIisPassword ? '1' : '0'}:${normalizedProfileUpdatedAt || 'v0'}`
      : null,
    initialData: null,
    load: loadOmissions,
    keepPreviousData: true,
    persistentCache: {
      key: omissionsPersistentCacheKey,
      maxAgeMs: 14 * 24 * 60 * 60 * 1000,
    },
    getErrorMessage: (requestError) =>
      getApiErrorMessage(
        requestError,
        'Не удалось загрузить пропуски по неуважительной причине.',
      ),
  })
  const reloadGrades = useCallback(() => {
    reload()
    reloadSummary()
  }, [reload, reloadSummary])

  const displayMessage = hasStudentCardNumber
    ? error
    : 'Укажите логин IIS в профиле, чтобы видеть успеваемость.'
  const blockingDisplayMessage = !hasData ? displayMessage : null
  const refreshError = hasData ? error : null
  const canRenderResults = hasStudentCardNumber && hasData
  const summary = useMemo(
    () => mergeGradesSummary(data?.summary, summaryData?.summary),
    [data?.summary, summaryData?.summary],
  )
  const subjects = data?.subjects ?? EMPTY_SUBJECTS
  const omissionMonths = omissionsData?.months ?? EMPTY_OMISSION_MONTHS
  const omissionSubjects =
    omissionsData?.subjects ?? EMPTY_OMISSION_SUBJECTS
  const omissionTotalHours = omissionsData?.totalHours ?? 0
  const warning =
    data?.warning ??
    summaryData?.warning ??
    (summaryError && hasData && summary?.position === undefined
      ? summaryError
      : undefined)
  const hasBlockingOmissionsError = isIisAuthorizationError(
    omissionsError,
  )
  const hasVisibleOmissionsData =
    hasOmissionsData && !hasBlockingOmissionsError
  const omissionsSetupMessage = hasIisCredentials
    ? null
    : normalizedIisLogin.length > 0
      ? 'Добавьте пароль IIS в профиле, чтобы загружать пропуски.'
      : 'Добавьте логин и пароль IIS в профиле, чтобы загружать пропуски.'
  const omissionSubjectLookup = useMemo(() => {
    return buildSubjectOmissionLookup(omissionSubjects)
  }, [omissionSubjects])
  const getSubjectOmissionCount = useCallback(
    (subjectName: string) =>
      resolveSubjectOmissionCount(subjectName, omissionSubjectLookup),
    [omissionSubjectLookup],
  )
  const { subjectSummaries, rating } = useMemo(
    () => {
      const overview = buildStudyOverview(subjects)

      return {
        subjectSummaries: overview.subjectSummaries,
        rating: overview.rating.slice(0, 5),
      }
    },
    [subjects],
  )
  const progressMarkColumns = useMemo(() => {
    const hasOtherMarks = subjectSummaries.some((subject) =>
      subject.markGroups.some((group) => group.key === 'other'),
    )

    return hasOtherMarks
      ? [...BASE_PROGRESS_MARK_COLUMNS, OTHER_PROGRESS_MARK_COLUMN]
      : BASE_PROGRESS_MARK_COLUMNS
  }, [subjectSummaries])
  const studyUpdatedAt =
    updatedAt === null
      ? summaryUpdatedAt
      : summaryUpdatedAt === null
        ? updatedAt
        : Math.max(updatedAt, summaryUpdatedAt)
  const isSummaryPending =
    canLoadGradesSummary &&
    !hasSummaryData &&
    (isSummaryInitialLoading || isSummaryRefreshing)
  const isPositionLoading =
    isInitialLoading ||
    (summary?.position === undefined && isSummaryPending)
  const isSpecialityLoading =
    isInitialLoading ||
    (summary?.speciality === undefined && isSummaryPending)
  const specialityLabel =
    summary?.speciality ?? 'Специальность не определена'
  const positionLabel = summary?.position ?? '—'
  const averageLabel = summary?.average?.toFixed(1) ?? '—'
  const studyMetaLabel = normalizedGroupNumber
    ? `Группа ${normalizedGroupNumber}`
    : 'Группа не указана'
  const studyStatusLabel = isRefreshing
    ? 'Обновляем оценки'
    : isSummaryRefreshing
      ? 'Уточняем рейтинг'
    : refreshError
      ? 'Показаны сохраненные данные'
      : 'Оценки / рейтинг'
  const studyStatusTone = isRefreshing || isSummaryRefreshing
    ? 'loading'
    : refreshError
      ? 'warning'
      : 'neutral'
  const omissionsStatusLabel = isOmissionsRefreshing
    ? 'Обновляем пропуски'
    : hasBlockingOmissionsError
      ? 'Ошибка авторизации IIS'
      : omissionsError && hasVisibleOmissionsData
      ? 'Показаны сохраненные данные'
      : 'Неуважительные пропуски'
  const omissionsStatusTone = isOmissionsRefreshing
    ? 'loading'
    : hasBlockingOmissionsError || (omissionsError && hasVisibleOmissionsData)
      ? 'warning'
      : 'neutral'

  if (role !== 'student') {
    return (
      <div className="planner-page">
        <div className="study-inner study-inner--modern">
          <header className="study-header">
            <div>
              <h1 className="planner-title">Учёба</h1>
              <p className="planner-subtitle">
                Для преподавателя раздел с оценками не нужен.
              </p>
            </div>
          </header>

          <section className="study-role-card">
            <h2 className="study-role-title">Роль преподавателя</h2>
            <p className="study-role-text">
              На преподавательском backend пока нет выдачи данных по
              успеваемости. Как только API появится и станет стабильным,
              раздел будет показывать данные по рейтингу и предметам.
            </p>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="planner-page">
      <div className="study-inner study-inner--modern">
        <header className="study-header">
          <div>
            <h1 className="planner-title">Учёба</h1>
            <p className="planner-subtitle">
              Следите за баллом успеваемости и пропусками из IIS.
            </p>
          </div>
        </header>

        <section className="study-student-card">
          <div className="study-student-topline">
            <span className="study-student-badge">Студент</span>
            <DataRefreshBadge
              label={studyStatusLabel}
              updatedAt={studyUpdatedAt}
              tone={studyStatusTone}
            />
          </div>

          <div className="study-student-copy">
            <p className="study-student-subtitle study-student-subtitle--meta">
              {studyMetaLabel}
              {' · '}
              Логин IIS {normalizedStudentCardNumber || 'не указан'}
            </p>
          </div>

          <div className="study-speciality-panel">
            <span className="study-speciality-label">Специальность</span>
            <h2 className="study-speciality-value">
              <StudyMetricValue
                isLoading={isSpecialityLoading}
                value={specialityLabel}
                className="study-inline-skeleton--speciality"
              />
            </h2>
          </div>

          <div className="study-student-metrics">
            <article className="study-metric-card study-metric-card--hero">
              <span className="study-metric-label">Ваше место</span>
              <div className="study-metric-main">
                <span
                  className="study-metric-icon study-metric-icon--rank"
                  aria-hidden="true"
                >
                  <Trophy size={18} />
                </span>
                <strong className="study-metric-value study-metric-value--hero">
                  <StudyMetricValue
                    isLoading={isPositionLoading}
                    value={positionLabel}
                    className="study-inline-skeleton--hero-metric"
                  />
                </strong>
              </div>
              <p className="study-metric-note">в рейтинге группы</p>
            </article>

            <article className="study-metric-card study-metric-card--hero study-metric-card--accent">
              <span className="study-metric-label">Средний балл</span>
              <div className="study-metric-main study-metric-main--reverse">
                <strong className="study-metric-value study-metric-value--hero">
                  <StudyMetricValue
                    isLoading={isInitialLoading}
                    value={averageLabel}
                    className="study-inline-skeleton--hero-metric"
                  />
                </strong>
                <span
                  className="study-metric-icon study-metric-icon--average"
                  aria-hidden="true"
                >
                  <Star size={18} />
                </span>
              </div>
              <p className="study-metric-note">по всем предметам</p>
            </article>
          </div>

          <div className="study-student-footnote">
            <span>Специальность, рейтинг и средний балл обновляются из IIS.</span>
          </div>
        </section>

        <section className="study-omissions-section">
          <div className="study-omissions-card">
            <div className="study-omissions-topline">
              <div>
                <h2 className="study-section-title">Пропуски</h2>
                <p className="study-omissions-subtitle">
                  Пропуски по неуважительной причине за текущий семестр.
                </p>
              </div>
              <DataRefreshBadge
                label={omissionsStatusLabel}
                updatedAt={omissionsUpdatedAt}
                tone={omissionsStatusTone}
              />
            </div>

            {isOmissionsInitialLoading ? (
              <div className="study-omissions-grid">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={`omissions-skeleton:${index}`}
                    className="study-omissions-month-card"
                    aria-hidden="true"
                  >
                    <span className="app-skeleton study-inline-skeleton study-inline-skeleton--omissions-label" />
                    <span className="app-skeleton study-inline-skeleton study-inline-skeleton--omissions-value" />
                  </div>
                ))}
              </div>
            ) : omissionsSetupMessage ? (
              <div className="study-empty-card study-empty-card--inline">
                <h3 className="study-empty-title">
                  Нужны данные IIS
                </h3>
                <p className="study-empty-subtitle">
                  {omissionsSetupMessage}
                </p>
              </div>
            ) : omissionsError && !hasVisibleOmissionsData ? (
              <div className="study-error-card study-error-card--inline">
                <p className="study-error-text">{omissionsError}</p>
                <button
                  type="button"
                  className="study-retry-button"
                  onClick={reloadOmissions}
                >
                  Повторить запрос
                </button>
              </div>
            ) : (
              <>
                <div className="study-omissions-summary">
                  <div className="study-omissions-total">
                    <span className="study-omissions-total-label">
                      Всего за семестр
                    </span>
                    <strong className="study-omissions-total-value">
                      {omissionTotalHours} ч.
                    </strong>
                  </div>
                  <p className="study-omissions-note">
                    Данные загружаются из личного кабинета IIS по сохранённому
                    логину.
                  </p>
                </div>

                {omissionsError && hasVisibleOmissionsData && (
                  <div className="study-error-card study-error-card--inline">
                    <p className="study-error-text">{omissionsError}</p>
                    <button
                      type="button"
                      className="study-retry-button"
                      onClick={reloadOmissions}
                    >
                      Обновить
                    </button>
                  </div>
                )}

                {omissionMonths.length > 0 ? (
                  <div className="study-omissions-grid">
                    {omissionMonths.map((month) => (
                      <article
                        key={month.month}
                        className="study-omissions-month-card"
                      >
                        <span className="study-omissions-month-name">
                          {month.month}
                        </span>
                        <strong className="study-omissions-month-value">
                          {month.omissionCount} ч.
                        </strong>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="study-empty-card study-empty-card--inline">
                    <h3 className="study-empty-title">Пропусков нет</h3>
                    <p className="study-empty-subtitle">
                      IIS пока не показывает часы пропусков по неуважительной
                      причине за этот семестр.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {isInitialLoading && <StudyLoadingState />}

        {blockingDisplayMessage && !isInitialLoading && (
          <div className="study-error-card">
            <p className="study-error-text">{blockingDisplayMessage}</p>
            {hasStudentCardNumber && (
              <button
                type="button"
                className="study-retry-button"
                onClick={reloadGrades}
              >
                Повторить запрос
              </button>
            )}
          </div>
        )}

        {canRenderResults && (
          <>
            {warning && (
              <div className="study-error-card">
                <p className="study-error-text">{warning}</p>
              </div>
            )}

            {rating.length > 0 && (
              <section className="study-rating-section">
                <h2 className="study-section-title">Топ предметов</h2>
                <div className="study-rating-row">
                  {rating.map((subject) => (
                    <article
                      key={`rating:${subject.id}`}
                      className="study-rating-card"
                    >
                      <span className="study-rating-score">
                        {subject.average.toFixed(1)}
                      </span>
                      <h3 className="study-rating-title">{subject.subject}</h3>
                      <p className="study-rating-meta">
                        {subject.marksCount}{' '}
                        {formatMarksLabel(subject.marksCount)}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="study-progress-section">
              <div className="study-progress-header">
                <div>
                  <h2 className="study-section-title">
                    Оценки и пропуски по предметам
                  </h2>
                  <p className="study-progress-note">
                    Таблица собрана по типам занятий. Нажмите на ячейку с
                    количеством оценок, чтобы увидеть сами оценки.
                  </p>
                </div>
              </div>

              <StudyProgressSection
                subjectSummaries={subjectSummaries}
                progressMarkColumns={progressMarkColumns}
                getSubjectOmissionCount={getSubjectOmissionCount}
              />
            </section>
          </>
        )}
      </div>
    </div>
  )
}
