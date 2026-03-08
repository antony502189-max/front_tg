const scheduleGroupSizes = [2, 3]
const studyRatingCards = [0, 1, 2]
const studySubjectCards = [0, 1, 2]
const refreshTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
})

const SkeletonBlock = ({ className }: { className: string }) => (
  <div className={`app-skeleton ${className}`} aria-hidden="true" />
)

type DataRefreshBadgeProps = {
  label: string
  updatedAt?: number | null
  tone?: 'loading' | 'neutral' | 'warning'
}

export const DataRefreshBadge = ({
  label,
  updatedAt = null,
  tone = 'neutral',
}: DataRefreshBadgeProps) => (
  <div
    className={`data-refresh-badge data-refresh-badge--${tone}`}
    role="status"
    aria-live="polite"
  >
    <span className="data-refresh-badge-main">
      <span className="data-refresh-badge-orb" aria-hidden="true" />
      {label}
    </span>
    {updatedAt ? (
      <span className="data-refresh-badge-time">
        {refreshTimeFormatter.format(updatedAt)}
      </span>
    ) : null}
  </div>
)

export const ScheduleLoadingState = () => (
  <section
    className="page-loading-state page-loading-state--schedule"
    aria-live="polite"
    aria-busy="true"
  >
    <div className="page-loading-state-header">
      <span className="page-loading-state-badge">
        <span className="page-loading-state-orb" aria-hidden="true" />
        Загружаем расписание
      </span>
      <p className="page-loading-state-caption">
        Собираем пары и аудитории для выбранного периода.
      </p>
    </div>

    <div className="schedule-loading-groups">
      {scheduleGroupSizes.map((lessonsCount, groupIndex) => (
        <article
          key={`schedule-loading-group:${groupIndex}`}
          className="schedule-loading-group"
        >
          <div className="schedule-loading-group-header">
            <SkeletonBlock className="schedule-loading-title" />
            <SkeletonBlock className="schedule-loading-subtitle" />
          </div>

          <div className="schedule-loading-lessons">
            {Array.from({ length: lessonsCount }, (_, lessonIndex) => (
              <div
                key={`schedule-loading-lesson:${groupIndex}:${lessonIndex}`}
                className="schedule-loading-lesson"
              >
                <div className="schedule-loading-lesson-top">
                  <SkeletonBlock className="schedule-loading-time" />
                  <SkeletonBlock className="schedule-loading-pill" />
                </div>
                <SkeletonBlock className="schedule-loading-lesson-title" />
                <div className="schedule-loading-meta">
                  <SkeletonBlock className="schedule-loading-meta-line" />
                  <SkeletonBlock className="schedule-loading-meta-pill" />
                  <SkeletonBlock className="schedule-loading-meta-pill schedule-loading-meta-pill--wide" />
                </div>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  </section>
)

export const StudyLoadingState = () => (
  <section
    className="page-loading-state page-loading-state--study"
    aria-live="polite"
    aria-busy="true"
  >
    <div className="page-loading-state-header">
      <span className="page-loading-state-badge">
        <span className="page-loading-state-orb" aria-hidden="true" />
        Загружаем оценки
      </span>
      <p className="page-loading-state-caption">
        Проверяем сводку по зачётке и оценки по предметам.
      </p>
    </div>

    <section className="study-loading-section">
      <SkeletonBlock className="study-loading-section-title" />
      <div className="study-loading-rating-row">
        {studyRatingCards.map((index) => (
          <article
            key={`study-loading-rating:${index}`}
            className="study-loading-rating-card"
          >
            <SkeletonBlock className="study-loading-score" />
            <SkeletonBlock className="study-loading-rating-title" />
            <SkeletonBlock className="study-loading-rating-meta" />
          </article>
        ))}
      </div>
    </section>

    <section className="study-loading-section">
      <SkeletonBlock className="study-loading-section-title study-loading-section-title--wide" />
      <div className="study-loading-subject-list">
        {studySubjectCards.map((index) => (
          <article
            key={`study-loading-subject:${index}`}
            className="study-loading-subject-card"
          >
            <div className="study-loading-subject-header">
              <div className="study-loading-subject-copy">
                <SkeletonBlock className="study-loading-subject-title" />
                <SkeletonBlock className="study-loading-subject-teacher" />
              </div>
              <SkeletonBlock className="study-loading-summary" />
            </div>

            <div className="study-loading-mark-row">
              <SkeletonBlock className="study-loading-mark" />
              <SkeletonBlock className="study-loading-mark" />
              <SkeletonBlock className="study-loading-mark" />
              <SkeletonBlock className="study-loading-mark" />
            </div>
          </article>
        ))}
      </div>
    </section>
  </section>
)
