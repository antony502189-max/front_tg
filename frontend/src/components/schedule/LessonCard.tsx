import { memo } from 'react'
import { Clock3, MapPin, UserRound, Users } from 'lucide-react'
import type { Lesson } from '../../store/scheduleStore'

export type LessonCardStatus = 'past' | 'current' | 'upcoming'

type LessonCardProps = {
  lesson: Lesson
  status: LessonCardStatus
}

const STATUS_LABELS: Partial<Record<LessonCardStatus, string>> = {
  current: 'Сейчас',
}

export const LessonCard = memo(({ lesson, status }: LessonCardProps) => {
  const isActual = status !== 'past'
  const statusLabel = STATUS_LABELS[status] ?? null
  const title = lesson.typeLabel
    ? `${lesson.subject} (${lesson.typeLabel})`
    : lesson.subject

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
        <div className="schedule-lesson-heading">
          <div className="schedule-lesson-heading-main">
            <h3 className="schedule-lesson-title">{title}</h3>
            <div className="schedule-lesson-time">
              <span className="schedule-lesson-time-icon" aria-hidden="true">
                <Clock3 size={15} />
              </span>
              <span className="schedule-lesson-time-range">
                {lesson.startTime} - {lesson.endTime}
              </span>
              {statusLabel && (
                <span className="schedule-lesson-state-pill">
                  {statusLabel}
                </span>
              )}
            </div>
          </div>

          <div className="schedule-lesson-heading-side">
            {lesson.room && (
              <span className="schedule-lesson-room">{lesson.room}</span>
            )}
            {lesson.subgroup && (
              <span className="schedule-lesson-subgroup-badge">
                <Users size={14} />
                {lesson.subgroup}
              </span>
            )}
          </div>
        </div>

        <div className="schedule-lesson-meta">
          {lesson.teacher && (
            <span className="schedule-lesson-pill schedule-lesson-pill--teacher">
              <UserRound size={14} />
              {lesson.teacher}
            </span>
          )}
          {isActual && lesson.typeLabel && (
            <span
              className={`schedule-lesson-kind schedule-lesson-kind--${lesson.typeKey}`}
            >
              {lesson.typeLabel}
            </span>
          )}
          {lesson.room && (
            <span className="schedule-lesson-pill schedule-lesson-pill--room">
              <MapPin size={14} />
              ауд. {lesson.room}
            </span>
          )}
        </div>
      </div>
    </article>
  )
})

LessonCard.displayName = 'LessonCard'
