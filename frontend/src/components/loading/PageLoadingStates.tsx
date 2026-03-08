const refreshTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
})

type DataRefreshBadgeProps = {
  label: string
  updatedAt?: number | null
  tone?: 'loading' | 'neutral' | 'warning'
}

const CompactLoadingIndicator = ({ label }: { label: string }) => (
  <section
    className="compact-loading-indicator"
    aria-live="polite"
    aria-busy="true"
    aria-label={label}
  >
    <span className="compact-loading-spinner" aria-hidden="true" />
  </section>
)

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
  <CompactLoadingIndicator label="Загружаем расписание" />
)

export const StudyLoadingState = () => (
  <CompactLoadingIndicator label="Загружаем оценки" />
)
