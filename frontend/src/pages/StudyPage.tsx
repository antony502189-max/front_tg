import { useCallback, useMemo } from 'react'
import { Star, Trophy } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { fetchGrades, type GradesResponse } from '../api/grades'
import {
  fetchOmissions,
  type OmissionsResponse,
} from '../api/omissions'
import { getApiErrorMessage } from '../api/client'
import {
  DataRefreshBadge,
  StudyLoadingState,
} from '../components/loading/PageLoadingStates'
import { useAsyncResource } from '../hooks/useAsyncResource'
import { useUserStore } from '../store/userStore'
import { resolveSessionUserId } from '../telegram/session'
import { buildStudyOverview, formatMarksLabel } from '../utils/study'

const EMPTY_SUBJECTS: GradesResponse['subjects'] = []
const EMPTY_OMISSION_MONTHS: OmissionsResponse['months'] = []
const EMPTY_OMISSION_SUBJECTS: OmissionsResponse['subjects'] = []

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

const getMarkTone = (value: number) => {
  if (value >= 8) {
    return 'success'
  }

  if (value >= 4) {
    return 'warning'
  }

  return 'danger'
}

const getAverageTone = (value: number | null) => {
  if (value === null) {
    return 'neutral'
  }

  return getMarkTone(value)
}

const getOmissionTone = (value: number | undefined) => {
  if (value === undefined) {
    return 'neutral'
  }

  if (value === 0) {
    return 'success'
  }

  if (value <= 3) {
    return 'warning'
  }

  return 'danger'
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

export const StudyPage = () => {
  const {
    role,
    groupNumber,
    studentCardNumber,
    iisLogin,
    hasIisPassword,
  } = useUserStore(
    useShallow((state) => ({
      role: state.role,
      groupNumber: state.groupNumber,
      studentCardNumber: state.studentCardNumber,
      iisLogin: state.iisLogin,
      hasIisPassword: state.hasIisPassword,
    })),
  )

  const sessionUserId = resolveSessionUserId()
  const normalizedSessionUserId = sessionUserId.trim()
  const normalizedIisLogin = iisLogin.trim()
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
    ? `grades:${normalizedStudentCardNumber}:${normalizedGroupNumber || 'nogroup'}`
    : null
  const omissionsPersistentCacheKey = canLoadOmissions
    ? `omissions:${normalizedSessionUserId}:${normalizedIisLogin}`
    : null

  const loadGrades = useCallback(
    (signal: AbortSignal) =>
      fetchGrades(normalizedStudentCardNumber, {
        groupNumber: normalizedGroupNumber,
        signal,
      }),
    [normalizedGroupNumber, normalizedStudentCardNumber],
  )
  const loadOmissions = useCallback(
    (signal: AbortSignal) =>
      fetchOmissions(normalizedSessionUserId, {
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
      ? `${normalizedStudentCardNumber}:${normalizedGroupNumber}`
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
      ? `omissions:${normalizedSessionUserId}:${normalizedIisLogin}:${hasIisPassword ? '1' : '0'}`
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

  const displayMessage = hasStudentCardNumber
    ? error
    : 'Укажите логин IIS в профиле, чтобы видеть успеваемость.'
  const blockingDisplayMessage = !hasData ? displayMessage : null
  const refreshError = hasData ? error : null
  const canRenderResults = hasStudentCardNumber && hasData
  const summary = data?.summary
  const subjects = data?.subjects ?? EMPTY_SUBJECTS
  const omissionMonths = omissionsData?.months ?? EMPTY_OMISSION_MONTHS
  const omissionSubjects =
    omissionsData?.subjects ?? EMPTY_OMISSION_SUBJECTS
  const omissionTotalHours = omissionsData?.totalHours ?? 0
  const warning = data?.warning
  const omissionsSetupMessage = hasIisCredentials
    ? null
    : normalizedIisLogin.length > 0
      ? 'Добавьте пароль IIS в профиле, чтобы загружать пропуски.'
      : 'Добавьте логин и пароль IIS в профиле, чтобы загружать пропуски.'
  const omissionSubjectLookup = useMemo(() => {
    return buildSubjectOmissionLookup(omissionSubjects)
  }, [omissionSubjects])
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
  const specialityLabel =
    summary?.speciality ?? 'Специальность не определена'
  const positionLabel = summary?.position ?? '—'
  const averageLabel = summary?.average?.toFixed(1) ?? '—'
  const studyMetaLabel = normalizedGroupNumber
    ? `Группа ${normalizedGroupNumber}`
    : 'Группа не указана'
  const studyStatusLabel = isRefreshing
    ? 'Обновляем данные'
    : refreshError
      ? 'Показаны сохраненные данные'
      : 'Оценки / рейтинг'
  const studyStatusTone = isRefreshing
    ? 'loading'
    : refreshError
      ? 'warning'
      : 'neutral'
  const omissionsStatusLabel = isOmissionsRefreshing
    ? 'Обновляем пропуски'
    : omissionsError && hasOmissionsData
      ? 'Показаны сохраненные данные'
      : 'Неуважительные пропуски'
  const omissionsStatusTone = isOmissionsRefreshing
    ? 'loading'
    : omissionsError && hasOmissionsData
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
              updatedAt={updatedAt}
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
                isLoading={isInitialLoading}
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
                    isLoading={isInitialLoading}
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
            ) : omissionsError && !hasOmissionsData ? (
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

                {omissionsError && hasOmissionsData && (
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
                onClick={reload}
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

            <section className="study-subjects-section">
              <div className="study-subjects-heading">
                <h2 className="study-section-title">
                  Оценки и пропуски по предметам
                </h2>
                <p className="study-subjects-caption">
                  В одной строке собраны средний балл, часы пропусков и
                  все оценки по дисциплине.
                </p>
              </div>

              {subjectSummaries.length > 0 ? (
                <div className="study-subjects-table-card">
                  <div
                    className="study-subjects-table-head"
                    aria-hidden="true"
                  >
                    <span className="study-subjects-table-head-label">
                      Предмет
                    </span>
                    <span className="study-subjects-table-head-label">
                      Преподаватель
                    </span>
                    <span className="study-subjects-table-head-label">
                      Средний
                    </span>
                    <span className="study-subjects-table-head-label">
                      Пропуски
                    </span>
                    <span className="study-subjects-table-head-label">
                      Оценки
                    </span>
                  </div>

                  <div className="study-subjects-table-body">
                  {subjectSummaries.map((subject) => {
                    const subjectOmissionCount = resolveSubjectOmissionCount(
                      subject.subject,
                      omissionSubjectLookup,
                    )
                    const omissionTone = getOmissionTone(
                      subjectOmissionCount,
                    )
                    const averageTone = getAverageTone(subject.average)

                    return (
                      <article
                        key={subject.id}
                        className="study-subject-row"
                      >
                        <div
                          className="study-subject-cell study-subject-cell--subject"
                          data-label="Предмет"
                        >
                          <h3 className="study-subject-row-title">
                            {subject.subject}
                          </h3>
                        </div>

                        <div
                          className="study-subject-cell study-subject-cell--teacher"
                          data-label="Преподаватель"
                        >
                          <p
                            className={`study-subject-row-teacher${
                              subject.teacher
                                ? ''
                                : ' study-subject-row-teacher--muted'
                            }`}
                          >
                            {subject.teacher ?? 'Не указан'}
                          </p>
                        </div>

                        <div
                          className="study-subject-cell study-subject-cell--metric"
                          data-label="Средний"
                        >
                          <div
                            className={`study-subject-stat study-subject-stat--${averageTone}`}
                          >
                            <strong className="study-subject-stat-value">
                              {subject.average?.toFixed(1) ?? '—'}
                            </strong>
                          </div>
                          <span className="study-subject-stat-note">
                            {subject.marksCount > 0
                              ? `${subject.marksCount} ${formatMarksLabel(subject.marksCount)}`
                              : 'Оценок пока нет'}
                          </span>
                        </div>

                        <div
                          className="study-subject-cell study-subject-cell--metric"
                          data-label="Пропуски"
                        >
                          <div
                            className={`study-subject-stat study-subject-stat--${omissionTone}`}
                          >
                            <strong className="study-subject-stat-value">
                              {subjectOmissionCount === undefined
                                ? '—'
                                : `${subjectOmissionCount} ч.`}
                            </strong>
                          </div>
                          <span className="study-subject-stat-note">
                            {subjectOmissionCount === undefined
                              ? 'Нет данных из IIS'
                              : subjectOmissionCount === 0
                                ? 'Без пропусков'
                                : 'Неуважительные часы'}
                          </span>
                        </div>

                        <div
                          className="study-subject-cell study-subject-cell--marks"
                          data-label="Оценки"
                        >
                          {subject.marks.length > 0 ? (
                            subject.hasTypedMarks ? (
                              <div className="study-mark-groups">
                                {subject.markGroups.map((group) => (
                                  <div
                                    key={`${subject.id}:${group.key}`}
                                    className="study-mark-group"
                                  >
                                    <span className="study-mark-group-label">
                                      {group.label}
                                    </span>
                                    <div className="study-marks-row">
                                      {group.marks.map((mark, index) => (
                                        <span
                                          key={`${subject.id}:${group.key}:${index}:${mark.value}`}
                                          className={`study-mark-badge study-mark-badge--${getMarkTone(mark.value)}`}
                                        >
                                          {mark.value}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="study-marks-row">
                                {subject.marks.map((mark, index) => (
                                  <span
                                    key={`${subject.id}:${index}:${mark.value}`}
                                    className={`study-mark-badge study-mark-badge--${getMarkTone(mark.value)}`}
                                  >
                                    {mark.value}
                                  </span>
                                ))}
                              </div>
                            )
                          ) : (
                            <span className="study-no-marks">
                              Оценок пока нет
                            </span>
                          )}
                        </div>
                      </article>
                    )
                  })}
                  </div>
                </div>
              ) : (
                <div className="study-empty-card">
                  <h2 className="study-empty-title">Оценок пока нет</h2>
                  <p className="study-empty-subtitle">
                    Как только данные появятся в IIS, они отобразятся здесь.
                  </p>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
