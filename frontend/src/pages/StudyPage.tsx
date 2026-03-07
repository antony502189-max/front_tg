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
  const hasStudentCardNumber = normalizedStudentCardNumber.length > 0
  const canLoadGrades = role === 'student' && hasStudentCardNumber

  const loadGrades = useCallback(
    (signal: AbortSignal) =>
      fetchGrades(normalizedStudentCardNumber, signal),
    [normalizedStudentCardNumber],
  )

  const {
    data,
    error,
    isLoading,
    reload,
    hasResolvedCurrentRequest,
  } = useAsyncResource<GradesResponse | null>({
    enabled: canLoadGrades,
    requestKey: canLoadGrades ? normalizedStudentCardNumber : null,
    initialData: null,
    load: loadGrades,
    getErrorMessage: (requestError) =>
      getApiErrorMessage(
        requestError,
        '?? ??????? ????????? ?????? ?? ????????????.',
      ),
  })

  const displayMessage = hasStudentCardNumber
    ? error
    : '???????? ????? ??????? ? ???????, ????? ??????? ????????????.'
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
              <h1 className="planner-title">?????</h1>
              <p className="planner-subtitle">
                ??? ??????? ?????? ???????? ?????? ??? ????????????? ???????.
              </p>
            </div>
          </header>

          <section className="study-role-card">
            <h2 className="study-role-title">????? ?????????????</h2>
            <p className="study-role-text">
              ??? ?????????????? backend ???? ?? ?????? ???? ? ????????. ????
              ????????????? ?? ???????? ? ???????? ????? ???????, ????? ????????
              ?????? ?? ??????????? ? ????????.
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
            <span className="study-kicker">???????</span>
            <h1 className="planner-title">?????</h1>
            <p className="planner-subtitle">
              ?????? ? ?????? ??????????? ????? backend ?? ?????? ?????
              ???????.
            </p>
          </div>
        </header>

        <section className="study-student-card">
          <div className="study-student-copy">
            <span className="study-student-badge">???????</span>
            <h2 className="study-student-title">
              {groupNumber.trim()
                ? `?????? ${groupNumber.trim()}`
                : '???????????? ???????'}
            </h2>
            <p className="study-student-subtitle">
              ??????? {normalizedStudentCardNumber || '?? ???????'}
            </p>
          </div>

          <div className="study-student-metrics">
            <div className="study-metric-card">
              <span className="study-metric-label">??????? ????</span>
              <strong className="study-metric-value">
                {summary?.average?.toFixed(1) ?? '?'}
              </strong>
            </div>

            <div className="study-metric-card">
              <span className="study-metric-label">???????</span>
              <strong className="study-metric-value">
                {summary?.position ?? '?'}
              </strong>
            </div>

            <div className="study-metric-card">
              <span className="study-metric-label">?????????????</span>
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
                ????????? ??????
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
                <h2 className="study-section-title">??? ?????????</h2>
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
              <h2 className="study-section-title">?????? ?? ?????????</h2>

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
                              ???????
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
                              ?????? ???? ???
                            </span>
                          )}
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <div className="study-empty-card">
                  <h2 className="study-empty-title">?????? ???? ???</h2>
                  <p className="study-empty-subtitle">
                    ??? ?????? ?????? ???????? ? IIS, ??? ??????????? ?????.
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
