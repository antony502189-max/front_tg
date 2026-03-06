import { useEffect, useMemo, useState } from 'react'
import { fetchGrades, type GradesResponse } from '../api/grades'
import { getApiErrorMessage } from '../api/client'
import { useUserStore } from '../store/userStore'

type GradesState = {
  requestKey: string | null
  data: GradesResponse | null
  error: string | null
}

type SubjectRating = {
  id: string
  subject: string
  teacher: string | undefined
  average: number
  marksCount: number
}

const formatMarksLabel = (count: number) => {
  const remainder100 = count % 100

  if (remainder100 >= 11 && remainder100 <= 14) {
    return 'оценок'
  }

  const remainder10 = count % 10

  if (remainder10 === 1) {
    return 'оценка'
  }

  if (remainder10 >= 2 && remainder10 <= 4) {
    return 'оценки'
  }

  return 'оценок'
}

export const StudyPage = () => {
  const studentCardNumber = useUserStore(
    (state) => state.studentCardNumber,
  )
  const normalizedStudentCardNumber = studentCardNumber?.trim() ?? ''

  const [reloadToken, setReloadToken] = useState(0)
  const [state, setState] = useState<GradesState>({
    requestKey: null,
    data: null,
    error: null,
  })
  const hasStudentCardNumber = normalizedStudentCardNumber.length > 0
  const requestKey = hasStudentCardNumber
    ? `${normalizedStudentCardNumber}:${reloadToken}`
    : null

  useEffect(() => {
    if (!requestKey) {
      return
    }

    let isCancelled = false

    void fetchGrades(normalizedStudentCardNumber)
      .then((data) => {
        if (isCancelled) return

        setState({
          requestKey,
          data,
          error: null,
        })
      })
      .catch((error) => {
        if (isCancelled) return

        setState({
          requestKey,
          data: null,
          error: getApiErrorMessage(
            error,
            'Не удалось загрузить данные об успеваемости.',
          ),
        })
      })

    return () => {
      isCancelled = true
    }
  }, [normalizedStudentCardNumber, requestKey])

  const hasResolvedCurrentRequest = state.requestKey === requestKey
  const data =
    hasStudentCardNumber && hasResolvedCurrentRequest
      ? state.data
      : null
  const isLoading = hasStudentCardNumber && !hasResolvedCurrentRequest
  const error =
    hasStudentCardNumber && hasResolvedCurrentRequest
      ? state.error
      : null
  const displayMessage = hasStudentCardNumber
    ? error
    : 'Добавьте номер студенческого в настройках, чтобы видеть успеваемость.'
  const canRenderResults =
    hasStudentCardNumber && hasResolvedCurrentRequest && !error
  const summary = data?.summary
  const subjects = data?.subjects ?? []
  const warning = data?.warning
  const hasSubjects = subjects.length > 0
  const subjectRating = useMemo<SubjectRating[]>(
    () =>
      subjects
        .map((subject) => {
          const validMarks = subject.marks
            .map((mark) => mark.value)
            .filter((value) => Number.isFinite(value))

          if (!validMarks.length) {
            return null
          }

          const total = validMarks.reduce(
            (sum, value) => sum + value,
            0,
          )

          return {
            id: subject.id,
            subject: subject.subject,
            teacher: subject.teacher,
            average: total / validMarks.length,
            marksCount: validMarks.length,
          }
        })
        .filter((item): item is SubjectRating => item !== null)
        .sort((left, right) => {
          if (right.average !== left.average) {
            return right.average - left.average
          }

          if (right.marksCount !== left.marksCount) {
            return right.marksCount - left.marksCount
          }

          return left.subject.localeCompare(right.subject, 'ru')
        }),
    [subjects],
  )

  const handleRetry = () => {
    setReloadToken((token) => token + 1)
  }

  return (
    <div className="planner-page">
      <div className="study-inner">
        <header className="study-header">
          <div>
            <h1 className="planner-title">Учёба</h1>
            <p className="planner-subtitle">
              Следите за успеваемостью и оценками по
              дисциплинам.
            </p>
          </div>
        </header>

        {isLoading && (
          <div className="study-skeleton-list">
            <div className="study-skeleton-card" />
            <div className="study-skeleton-card" />
          </div>
        )}

        {!isLoading && displayMessage && (
          <div className="study-error-card">
            <p className="study-error-text">{displayMessage}</p>
            {normalizedStudentCardNumber && (
              <button
                type="button"
                className="study-retry-button"
                onClick={handleRetry}
              >
                Повторить попытку
              </button>
            )}
          </div>
        )}

        {!isLoading && canRenderResults && (
          <>
            {warning && (
              <div className="study-error-card">
                <p className="study-error-text">{warning}</p>
              </div>
            )}

            {summary && (
              <section className="study-summary-card">
                <div className="study-summary-header">
                  <h2 className="study-summary-title">
                    Краткая сводка
                  </h2>
                  {summary.speciality && (
                    <span className="study-summary-pill">
                      {summary.speciality}
                    </span>
                  )}
                </div>
                <div className="study-summary-grid">
                  <div className="study-summary-item">
                    <span className="study-summary-label">
                      Средний балл
                    </span>
                    <span className="study-summary-value">
                      {summary.average?.toFixed(1) ?? '—'}
                    </span>
                  </div>
                  <div className="study-summary-item">
                    <span className="study-summary-label">
                      Позиция в рейтинге
                    </span>
                    <span className="study-summary-value">
                      {summary.position ?? '—'}
                    </span>
                  </div>
                </div>
              </section>
            )}

            {subjectRating.length > 0 && (
              <section className="study-rating-section">
                <h2 className="study-section-title">
                  Рейтинг по оценкам
                </h2>
                <div className="study-rating-list">
                  {subjectRating.map((subject, index) => (
                    <article
                      key={`rating-${subject.id}`}
                      className="study-rating-card"
                    >
                      <div className="study-rating-place">
                        {index + 1}
                      </div>
                      <div className="study-rating-content">
                        <h3 className="study-rating-title">
                          {subject.subject}
                        </h3>
                        <p className="study-rating-meta">
                          {subject.teacher
                            ? `${subject.teacher} · `
                            : ''}
                          {subject.marksCount}{' '}
                          {formatMarksLabel(subject.marksCount)}
                        </p>
                      </div>
                      <div className="study-rating-score">
                        {subject.average.toFixed(1)}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="study-subjects-section">
              <h2 className="study-section-title">
                Дисциплины
              </h2>

              {hasSubjects ? (
                <div className="study-subject-list">
                  {subjects.map((subject) => (
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
                      </header>

                      <div className="study-marks-row">
                        {subject.marks.length > 0 ? (
                          subject.marks.map((mark, index) => (
                            <span
                              key={`${subject.id}-${index}-${mark.value}`}
                              className="study-mark-badge"
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
                  ))}
                </div>
              ) : (
                <div className="study-empty-card">
                  <h3 className="study-empty-title">
                    {warning ? 'Оценки недоступны' : 'Пока нет данных'}
                  </h3>
                  <p className="study-empty-subtitle">
                    {warning
                      ? 'Проверьте номер студенческого в настройках или попробуйте позже.'
                      : 'Как только в системе появятся оценки, вы увидите их здесь.'}
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
