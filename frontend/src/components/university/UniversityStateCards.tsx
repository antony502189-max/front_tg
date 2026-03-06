type UniversityTextCardProps = {
  className: string
  title: string
  subtitle: string
}

type UniversityActionCardProps = {
  text: string
  actionLabel: string
  onAction: () => void
}

export const UniversityTextCard = ({
  className,
  title,
  subtitle,
}: UniversityTextCardProps) => (
  <div className={className}>
    <h3 className="univer-helper-title">{title}</h3>
    <p className="univer-helper-subtitle">{subtitle}</p>
  </div>
)

export const UniversityActionCard = ({
  text,
  actionLabel,
  onAction,
}: UniversityActionCardProps) => (
  <div className="univer-error-card">
    <p className="univer-error-text">{text}</p>
    <button
      type="button"
      className="univer-retry-button"
      onClick={onAction}
    >
      {actionLabel}
    </button>
  </div>
)

export const UniversitySkeletonList = () => (
  <div className="univer-skeleton-list">
    <div className="univer-skeleton-card" />
    <div className="univer-skeleton-card" />
  </div>
)
