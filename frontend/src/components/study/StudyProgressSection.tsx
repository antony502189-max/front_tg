import { useEffect, useMemo, useState } from 'react'
import type { GradeMark } from '../../api/grades'
import {
  formatMarksLabel,
  type StudyMarkGroupKey,
  type StudySubjectSummary,
} from '../../utils/study'

export type StudyProgressColumn = {
  key: StudyMarkGroupKey
  label: string
}

type StudyProgressTone =
  | 'success'
  | 'warning'
  | 'danger'
  | 'muted'

type StudyProgressSectionProps = {
  subjectSummaries: StudySubjectSummary[]
  progressMarkColumns: StudyProgressColumn[]
  getSubjectOmissionCount: (subjectName: string) => number | undefined
}

const getMarkTone = (
  value: number,
): Exclude<StudyProgressTone, 'muted'> => {
  if (value >= 8) {
    return 'success'
  }

  if (value >= 4) {
    return 'warning'
  }

  return 'danger'
}

const getGroupAverage = (marks: GradeMark[]) => {
  if (marks.length === 0) {
    return null
  }

  const total = marks.reduce((sum, mark) => sum + mark.value, 0)
  return total / marks.length
}

const getProgressMarkGroup = (
  subject: StudySubjectSummary,
  key: StudyMarkGroupKey,
) => subject.markGroups.find((group) => group.key === key)

const getProgressCellTone = (
  marks: GradeMark[],
): StudyProgressTone => {
  if (marks.length === 0) {
    return 'muted'
  }

  const average = getGroupAverage(marks)
  return average === null ? 'muted' : getMarkTone(average)
}

const getOmissionCellTone = (
  value: number | undefined,
): StudyProgressTone => {
  if (value === undefined) {
    return 'muted'
  }

  if (value === 0) {
    return 'success'
  }

  if (value <= 3) {
    return 'warning'
  }

  return 'danger'
}

const formatProgressCellMeta = (marks: GradeMark[]) => {
  if (marks.length === 0) {
    return 'нет оценок'
  }

  const average = getGroupAverage(marks)
  return average === null ? 'без среднего' : `${average.toFixed(1)} ср.`
}

const formatProgressMarkValue = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(1)

const getOmissionCellMeta = (value: number | undefined) => {
  if (value === undefined) {
    return 'нет данных'
  }

  if (value === 0) {
    return 'без пропусков'
  }

  return 'неуваж.'
}

const getPopoverAlignmentClass = (
  columnIndex: number,
  totalColumns: number,
) => {
  if (columnIndex === totalColumns - 1) {
    return 'study-progress-popover--end'
  }

  if (columnIndex > 0) {
    return 'study-progress-popover--center'
  }

  return ''
}

const StudyProgressMetricButton = ({
  ariaLabel,
  isActive = false,
  isStatic = false,
  onClick,
  primary,
  secondary,
  tone,
}: {
  ariaLabel?: string
  isActive?: boolean
  isStatic?: boolean
  onClick?: () => void
  primary: string
  secondary: string
  tone: StudyProgressTone
}) => {
  const content = (
    <>
      <span className="study-progress-cell-count">{primary}</span>
      <span className="study-progress-cell-hours">{secondary}</span>
    </>
  )

  if (isStatic) {
    return (
      <div
        className={`study-progress-cell-button study-progress-cell-button--${tone} study-progress-cell-button--static`}
      >
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={`study-progress-cell-button study-progress-cell-button--${tone}${
        isActive ? ' study-progress-cell-button--active' : ''
      }`}
      aria-expanded={isActive}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {content}
    </button>
  )
}

const StudyMarksDetails = ({
  marks,
  title,
}: {
  marks: GradeMark[]
  title: string
}) => (
  <>
    <span className="study-progress-popover-label">{title}</span>
    <div className="study-progress-popover-list">
      {marks.map((mark, markIndex) => (
        <div
          key={`${title}:${markIndex}:${mark.value}`}
          className="study-progress-popover-item"
        >
          <span
            className={`study-mark-badge study-mark-badge--${getMarkTone(mark.value)}`}
          >
            {formatProgressMarkValue(mark.value)}
          </span>
          <span className="study-progress-popover-item-text">
            {mark.date ?? `Оценка ${markIndex + 1}`}
          </span>
        </div>
      ))}
    </div>
  </>
)

export const StudyProgressSection = ({
  subjectSummaries,
  progressMarkColumns,
  getSubjectOmissionCount,
}: StudyProgressSectionProps) => {
  const [activeProgressCellId, setActiveProgressCellId] =
    useState<string | null>(null)

  const openedProgressCellId = useMemo(() => {
    if (activeProgressCellId === null) {
      return null
    }

    const hasActiveCell = subjectSummaries.some((subject) =>
      progressMarkColumns.some(
        (column) => `${subject.id}:${column.key}` === activeProgressCellId,
      ),
    )

    return hasActiveCell ? activeProgressCellId : null
  }, [activeProgressCellId, progressMarkColumns, subjectSummaries])

  useEffect(() => {
    if (openedProgressCellId === null) {
      return undefined
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }

      const progressCell = target.closest('[data-progress-cell-id]')
      if (
        progressCell?.getAttribute('data-progress-cell-id') ===
        openedProgressCellId
      ) {
        return
      }

      setActiveProgressCellId(null)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveProgressCellId(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openedProgressCellId])

  const toggleProgressCell = (cellId: string) => {
    setActiveProgressCellId((current) =>
      current === cellId ? null : cellId,
    )
  }

  if (subjectSummaries.length === 0) {
    return (
      <div className="study-empty-card">
        <h2 className="study-empty-title">Оценок пока нет</h2>
        <p className="study-empty-subtitle">
          Как только данные появятся в IIS, они отобразятся здесь.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="study-progress-table-shell study-progress-layout--desktop">
        <div className="study-progress-table-scroll">
          <table className="study-progress-table">
            <thead>
              <tr>
                <th rowSpan={2} className="study-progress-index-head">
                  №
                </th>
                <th
                  rowSpan={2}
                  className="study-progress-subject-head-cell"
                >
                  Предмет
                </th>
                <th colSpan={progressMarkColumns.length}>
                  <span className="study-progress-total-head-inner">
                    Контрольные точки
                  </span>
                </th>
                <th rowSpan={2}>Пропуски</th>
              </tr>
              <tr>
                {progressMarkColumns.map((column) => (
                  <th
                    key={`study-progress-head:${column.key}`}
                    className="study-progress-kind-head"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {subjectSummaries.map((subject, index) => {
                const subjectOmissionCount = getSubjectOmissionCount(
                  subject.subject,
                )
                const omissionTone =
                  getOmissionCellTone(subjectOmissionCount)

                return (
                  <tr key={subject.id}>
                    <td className="study-progress-index-cell">
                      {index + 1}
                    </td>
                    <td className="study-progress-subject-cell">
                      <div className="study-progress-subject-copy">
                        <strong className="study-progress-subject-name">
                          {subject.subject}
                        </strong>
                        <span className="study-progress-subject-teacher">
                          {subject.teacher ?? 'Преподаватель не указан'}
                        </span>
                        <span className="study-progress-subject-meta">
                          {subject.average?.toFixed(1) ?? '—'} ср. ·{' '}
                          {subject.marksCount}{' '}
                          {formatMarksLabel(subject.marksCount)}
                        </span>
                      </div>
                    </td>

                    {progressMarkColumns.map((column, columnIndex) => {
                      const markGroup = getProgressMarkGroup(
                        subject,
                        column.key,
                      )
                      const marks = markGroup?.marks ?? []
                      const cellId = `${subject.id}:${column.key}`
                      const isActive = openedProgressCellId === cellId
                      const tone = getProgressCellTone(marks)
                      const popoverAlignmentClass =
                        getPopoverAlignmentClass(
                          columnIndex,
                          progressMarkColumns.length,
                        )

                      return (
                        <td
                          key={`${subject.id}:${column.key}`}
                          className="study-progress-value-cell"
                        >
                          <div
                            className="study-progress-cell-wrap"
                            data-progress-cell-id={cellId}
                          >
                            <StudyProgressMetricButton
                              tone={tone}
                              primary={`${marks.length} шт.`}
                              secondary={formatProgressCellMeta(marks)}
                              isStatic={marks.length === 0}
                              isActive={isActive}
                              ariaLabel={`${subject.subject}, ${column.label}: ${marks.length} ${formatMarksLabel(marks.length)}`}
                              onClick={
                                marks.length > 0
                                  ? () => toggleProgressCell(cellId)
                                  : undefined
                              }
                            />

                            {isActive && (
                              <div
                                className={`study-progress-popover ${popoverAlignmentClass}`.trim()}
                              >
                                <StudyMarksDetails
                                  marks={marks}
                                  title={`${subject.subject} · ${column.label}`}
                                />
                              </div>
                            )}
                          </div>
                        </td>
                      )
                    })}

                    <td className="study-progress-value-cell">
                      <div className="study-progress-cell-wrap">
                        <StudyProgressMetricButton
                          tone={omissionTone}
                          primary={
                            subjectOmissionCount === undefined
                              ? '—'
                              : `${subjectOmissionCount} ч.`
                          }
                          secondary={getOmissionCellMeta(
                            subjectOmissionCount,
                          )}
                          isStatic
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="study-progress-mobile-list study-progress-layout--mobile">
        {subjectSummaries.map((subject, index) => {
          const subjectOmissionCount = getSubjectOmissionCount(
            subject.subject,
          )
          const omissionTone =
            getOmissionCellTone(subjectOmissionCount)

          return (
            <article
              key={`mobile:${subject.id}`}
              className="study-progress-mobile-card"
            >
              <div className="study-progress-mobile-head">
                <div className="study-progress-mobile-index">
                  {index + 1}
                </div>
                <div className="study-progress-mobile-subject-copy">
                  <strong className="study-progress-subject-name">
                    {subject.subject}
                  </strong>
                  <span className="study-progress-subject-teacher">
                    {subject.teacher ?? 'Преподаватель не указан'}
                  </span>
                  <span className="study-progress-subject-meta">
                    {subject.average?.toFixed(1) ?? '—'} ср. ·{' '}
                    {subject.marksCount}{' '}
                    {formatMarksLabel(subject.marksCount)}
                  </span>
                </div>
              </div>

              <div className="study-progress-mobile-grid">
                {progressMarkColumns.map((column) => {
                  const markGroup = getProgressMarkGroup(
                    subject,
                    column.key,
                  )
                  const marks = markGroup?.marks ?? []
                  const cellId = `${subject.id}:${column.key}`
                  const isActive = openedProgressCellId === cellId
                  const tone = getProgressCellTone(marks)

                  return (
                    <div
                      key={`mobile:${subject.id}:${column.key}`}
                      className="study-progress-mobile-metric"
                    >
                      <span className="study-progress-mobile-metric-label">
                        {column.label}
                      </span>
                      <div
                        className="study-progress-cell-wrap study-progress-mobile-cell-wrap"
                        data-progress-cell-id={cellId}
                      >
                        <StudyProgressMetricButton
                          tone={tone}
                          primary={`${marks.length} шт.`}
                          secondary={formatProgressCellMeta(marks)}
                          isStatic={marks.length === 0}
                          isActive={isActive}
                          ariaLabel={`${subject.subject}, ${column.label}: ${marks.length} ${formatMarksLabel(marks.length)}`}
                          onClick={
                            marks.length > 0
                              ? () => toggleProgressCell(cellId)
                              : undefined
                          }
                        />

                        {isActive && (
                          <div className="study-progress-inline-details">
                            <StudyMarksDetails
                              marks={marks}
                              title={`${subject.subject} · ${column.label}`}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}

                <div className="study-progress-mobile-metric">
                  <span className="study-progress-mobile-metric-label">
                    Пропуски
                  </span>
                  <div className="study-progress-cell-wrap study-progress-mobile-cell-wrap">
                    <StudyProgressMetricButton
                      tone={omissionTone}
                      primary={
                        subjectOmissionCount === undefined
                          ? '—'
                          : `${subjectOmissionCount} ч.`
                      }
                      secondary={getOmissionCellMeta(
                        subjectOmissionCount,
                      )}
                      isStatic
                    />
                  </div>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </>
  )
}
