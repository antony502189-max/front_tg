import { memo } from 'react'
import type { Lesson } from '../../store/scheduleStore'

export type LessonCardStatus = 'past' | 'current' | 'upcoming'

type LessonCardProps = {
  lesson: Lesson
  status: LessonCardStatus
}

const STATUS_LABELS: Partial<Record<LessonCardStatus, string>> = {
  current: '??????',
}

export const LessonCard = memo(({ lesson, status }: LessonCardProps) => {
  const isActual = status !== 'past'
  const statusLabel = STATUS_LABELS[status] ?? null

  return (
    <article
      className={`schedule-lesson-card schedule-lesson-card--${status}`}
    >
      <span
        className={`schedule-lesson-accent schedule-lesson-accent--${
          isActual ? lesson.typeKey : 'muted'
        }`}
        aria-hidden="true"
      />

      <div className="schedule-lesson-body">
        <div className="schedule-lesson-topline">
          <div className="schedule-lesson-time">
            <span className="schedule-lesson-time-range">
              {lesson.startTime} - {lesson.endTime}
            </span>
            {statusLabel && (
              <span className="schedule-lesson-state-pill">{statusLabel}</span>
            )}
          </div>

          {isActual && lesson.typeLabel && (
            <span
              className={`schedule-lesson-kind schedule-lesson-kind--${lesson.typeKey}`}
            >
              {lesson.typeLabel}
            </span>
          )}
        </div>

        <div className="schedule-lesson-main">
          <h3 className="schedule-lesson-title">{lesson.subject}</h3>
          <div className="schedule-lesson-meta">
            {lesson.teacher && (
              <span className="schedule-lesson-text">{lesson.teacher}</span>
            )}
            {lesson.room && (
              <span className="schedule-lesson-pill">???. {lesson.room}</span>
            )}
          </div>
        </div>
      </div>
    </article>
  )
})

LessonCard.displayName = 'LessonCard'
