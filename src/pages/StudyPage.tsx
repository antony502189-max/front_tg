import { useEffect, useState } from 'react'
import { fetchGrades } from '../api/grades'
import type { GradesResponse } from '../mocks/grades'
import { useUserStore } from '../store/userStore'

type GradesState = {
  data: GradesResponse | null
  isLoading: boolean
  error: string | null
}

export const StudyPage = () => {
  const studentCardNumber = useUserStore(
    (state) => state.studentCardNumber,
  )

  const [reloadToken, setReloadToken] = useState(0)
  const [state, setState] = useState<GradesState>({
    data: null,
    isLoading: false,
    error: null,
  })

  useEffect(() => {
    if (!studentCardNumber) {
      return
    }

    let isCancelled = false

    queueMicrotask(() => {
      if (isCancelled) return

      setState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
      }))
    })

    fetchGrades(studentCardNumber)
      .then((data) => {
        if (isCancelled) return

        setState({
          data,
          isLoading: false,
          error: null,
        })
      })
      .catch(() => {
        if (isCancelled) return

        setState({
          data: null,
          isLoading: false,
          error: 'Не удалось загрузить данные об успеваемости.',
        })
      })

    return () => {
      isCancelled = true
    }
  }, [studentCardNumber, reloadToken])

  const { data, isLoading, error } = state
  const displayError =
    error ??
    (!studentCardNumber
      ? 'Добавьте номер студенческого в настройках, чтобы видеть успеваемость.'
      : null)
  const summary = data?.summary
  const subjects = data?.subjects ?? []
  const hasSubjects = subjects.length > 0

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

        {!isLoading && displayError && (
          <div className="study-error-card">
            <p className="study-error-text">{displayError}</p>
            {studentCardNumber && (
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

        {!isLoading && !error && (
          <>
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
                    Пока нет данных
                  </h3>
                  <p className="study-empty-subtitle">
                    Как только в системе появятся оценки, вы
                    увидите их здесь.
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
