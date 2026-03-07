import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { fetchGrades, type GradesResponse } from '../api/grades'
import { getApiErrorMessage } from '../api/client'
import { useAsyncResource } from '../hooks/useAsyncResource'
import { useUserStore } from '../store/userStore'
import { buildSubjectRating, formatMarksLabel } from '../utils/study'

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
    isLoading,
    reload,
    hasResolvedCurrentRequest,
  } = useAsyncResource<GradesResponse | null>({
    enabled: canLoadGrades,
    requestKey: canLoadGrades
      ? `${normalizedStudentCardNumber}:${normalizedGroupNumber}`
      : null,
    initialData: null,
    load: loadGrades,
    getErrorMessage: (requestError) =>
      getApiErrorMessage(
        requestError,
        'Не удалось загрузить оценки по успеваемости.',
      ),
  })

  const displayMessage = hasStudentCardNumber
    ? error
    : 'Укажите номер зачётки в профиле, чтобы видеть успеваемость.'
  const canRenderResults =
    hasStudentCardNumber && hasResolvedCurrentRequest && !error
  const summary = data?.summary
  const subjects = data?.subjects ?? EMPTY_SUBJECTS
  const warning = data?.warning
  const rating = useMemo(
    () => buildSubjectRating(subjects).slice(0, 5),
    [subjects],
  )

  if (role !== 'student') {
    return (
      <div className="planner-page">
        <div className="study-inner study-inner--modern">
          <header className="study-header">
            <div>
              <h1 className="planner-title">Учёба</h1>
              <p className="planner-subtitle">
                Для преподавателя раздел оценок пока недоступен в текущей версии.
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
            <span className="study-kicker">Успеваемость</span>
            <h1 className="planner-title">Учёба</h1>
            <p className="planner-subtitle">
              Следите за баллом успеваемости через backend по номеру вашей
              зачётки.
            </p>
          </div>
        </header>

        <section className="study-student-card">
          <div className="study-student-copy">
            <span className="study-student-badge">Студент</span>
            <h2 className="study-student-title">
              {groupNumber.trim()
                ? `Группа ${groupNumber.trim()}`
                : 'Не указана группа'}
            </h2>
            <p className="study-student-subtitle">
              Зачётка {normalizedStudentCardNumber || 'не указана'}
            </p>
          </div>

          <div className="study-student-metrics">
            <div className="study-metric-card">
              <span className="study-metric-label">Средний балл</span>
              <strong className="study-metric-value">
                {summary?.average?.toFixed(1) ?? '?'}
              </strong>
            </div>

            <div className="study-metric-card">
              <span className="study-metric-label">Позиция</span>
              <strong className="study-metric-value">
                {summary?.position ?? '?'}
              </strong>
            </div>

            <div className="study-metric-card">
              <span className="study-metric-label">Специальность</span>
              <strong className="study-metric-value study-metric-value--compact">
                {summary?.speciality ?? '?'}
              </strong>
            </div>
          </div>
        </section>

        {isLoading && (
          <div className="study-skeleton-list">
            <div className="study-skeleton-card" />
            <div className="study-skeleton-card" />
            <div className="study-skeleton-card" />
          </div>
        )}

        {!isLoading && displayMessage && (
          <div className="study-error-card">
            <p className="study-error-text">{displayMessage}</p>
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

        {!isLoading && canRenderResults && (
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

              {subjects.length > 0 ? (
                <div className="study-subject-list">
                  {subjects.map((subject) => {
                    const subjectAverage =
                      subject.marks.length > 0
                        ? (
                            subject.marks.reduce(
                              (sum, mark) => sum + mark.value,
                              0,
                            ) / subject.marks.length
                          ).toFixed(1)
                        : null

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
                              {subjectAverage ?? '?'}
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
