import { useCallback, useMemo } from 'react'
import { Star, Trophy } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { fetchGrades, type GradesResponse } from '../api/grades'
import { getApiErrorMessage } from '../api/client'
import {
  DataRefreshBadge,
  StudyLoadingState,
} from '../components/loading/PageLoadingStates'
import { useAsyncResource } from '../hooks/useAsyncResource'
import { useUserStore } from '../store/userStore'
import { buildStudyOverview, formatMarksLabel } from '../utils/study'

const EMPTY_SUBJECTS: GradesResponse['subjects'] = []

const getMarkTone = (value: number) => {
  if (value >= 8) {
    return 'success'
  }

  if (value >= 4) {
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
  const { role, groupNumber, studentCardNumber } = useUserStore(
    useShallow((state) => ({
      role: state.role,
      groupNumber: state.groupNumber,
      studentCardNumber: state.studentCardNumber,
    })),
  )

  const normalizedStudentCardNumber = studentCardNumber.trim()
  const normalizedGroupNumber = groupNumber.trim()
  const hasStudentCardNumber = normalizedStudentCardNumber.length > 0
  const canLoadGrades = role === 'student' && hasStudentCardNumber

  const loadGrades = useCallback(
    (signal: AbortSignal) =>
      fetchGrades(normalizedStudentCardNumber, {
        groupNumber: normalizedGroupNumber,
        signal,
      }),
    [normalizedGroupNumber, normalizedStudentCardNumber],
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
    getErrorMessage: (requestError) =>
      getApiErrorMessage(
        requestError,
        'Не удалось загрузить оценки по успеваемости.',
      ),
  })

  const displayMessage = hasStudentCardNumber
    ? error
    : 'Укажите номер зачётки в профиле, чтобы видеть успеваемость.'
  const blockingDisplayMessage = !hasData ? displayMessage : null
  const refreshError = hasData ? error : null
  const canRenderResults = hasStudentCardNumber && hasData
  const summary = data?.summary
  const subjects = data?.subjects ?? EMPTY_SUBJECTS
  const warning = data?.warning
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
              На преподавательском backend пока нет выдачи оценок и зачётки. Как
              только API появится и станет стабильным, раздел будет показывать
              данные по успеваемости и рейтингу.
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
              Следите за баллом успеваемости по номеру вашей
              зачётки.
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
              Зачётка {normalizedStudentCardNumber || 'не указана'}
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
              <h2 className="study-section-title">Оценки по предметам</h2>

              {subjectSummaries.length > 0 ? (
                <div className="study-subject-list">
                  {subjectSummaries.map((subject) => {
                    return (
                      <article
                        key={subject.id}
                        className="study-subject-card"
                      >
                        <header className="study-subject-header">
                          <div>
                            <h3 className="study-subject-title">
                              {subject.subject}
                            </h3>
                            {subject.teacher && (
                              <p className="study-subject-teacher">
                                {subject.teacher}
                              </p>
                            )}
                          </div>

                          <div className="study-subject-summary">
                            <span className="study-subject-summary-label">
                              Средний
                            </span>
                            <strong className="study-subject-summary-value">
                              {subject.average?.toFixed(1) ?? '?'}
                            </strong>
                          </div>
                        </header>

                        <div className="study-marks-row">
                          {subject.marks.length > 0 ? (
                            subject.marks.map((mark, index) => (
                              <span
                                key={`${subject.id}:${index}:${mark.value}`}
                                className={`study-mark-badge study-mark-badge--${getMarkTone(mark.value)}`}
                              >
                                {mark.value}
                              </span>
                            ))
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
