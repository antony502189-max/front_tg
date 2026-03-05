import type { Lesson } from '../../store/scheduleStore'

type LessonCardProps = {
  lesson: Lesson
  isCurrent?: boolean
  isNext?: boolean
}

export const LessonCard = ({
  lesson,
  isCurrent = false,
  isNext = false,
}: LessonCardProps) => {
  const stateLabel = isCurrent ? 'Сейчас' : isNext ? 'Следующая' : null

  return (
    <article
      className={`schedule-lesson-card${
        isCurrent ? ' schedule-lesson-card--current' : ''
      }${isNext ? ' schedule-lesson-card--next' : ''}`}
    >
      <div className="schedule-lesson-time">
        <span className="schedule-lesson-time-range">
          {lesson.startTime}–{lesson.endTime}
        </span>
        {stateLabel && (
          <span className="schedule-lesson-state-pill">
            {stateLabel}
          </span>
        )}
      </div>

      <div className="schedule-lesson-main">
        <h3 className="schedule-lesson-title">{lesson.subject}</h3>
        <div className="schedule-lesson-meta">
          {lesson.teacher && (
            <span className="schedule-lesson-text">
              {lesson.teacher}
            </span>
          )}
          {lesson.room && (
            <span className="schedule-lesson-pill">
              Ауд. {lesson.room}
            </span>
          )}
          {lesson.type && (
            <span className="schedule-lesson-pill schedule-lesson-pill--type">
              {lesson.type}
            </span>
          )}
        </div>
      </div>
    </article>
  )
}

