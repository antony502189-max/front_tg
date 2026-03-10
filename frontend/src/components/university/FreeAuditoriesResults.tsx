import { parseDateKey } from '../../utils/date'
import type { FreeAuditory } from '../../types/user'
import {
  UniversityActionCard,
  UniversitySkeletonList,
  UniversityTextCard,
} from './UniversityStateCards'

type FreeAuditoriesResultsProps = {
  hasProfileIdentity: boolean
  hasQuery: boolean
  isLoading: boolean
  error: string | null
  items: FreeAuditory[]
  generatedAt: string
  onRetry: () => void
}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
})

const formatGeneratedAt = (value: string) => {
  if (!value) {
    return null
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return timeFormatter.format(parsed)
}

const formatNextBusyLabel = (
  nextBusyLesson: FreeAuditory['nextBusyLesson'],
) => {
  if (!nextBusyLesson?.date || !nextBusyLesson.startTime) {
    return 'В ближайшем расписании занятий для этой аудитории ничего не найдено.'
  }

  const parsedDate = parseDateKey(nextBusyLesson.date)
  const dateLabel = parsedDate
    ? dateFormatter.format(parsedDate)
    : nextBusyLesson.date

  const subjectLabel = nextBusyLesson.subject
    ? `${nextBusyLesson.subject}. `
    : ''

  return `${subjectLabel}${dateLabel}, ${nextBusyLesson.startTime}-${nextBusyLesson.endTime ?? '?'}`
}

const formatCurrentLessonLabel = (
  currentLesson: FreeAuditory['currentLesson'],
) => {
  if (!currentLesson?.date || !currentLesson.startTime) {
    return 'Сейчас по расписанию занятий в этой аудитории нет.'
  }

  const parsedDate = parseDateKey(currentLesson.date)
  const dateLabel = parsedDate
    ? dateFormatter.format(parsedDate)
    : currentLesson.date

  const subjectLabel = currentLesson.subject
    ? `${currentLesson.subject}. `
    : ''

  return `${subjectLabel}${dateLabel}, ${currentLesson.startTime}-${currentLesson.endTime ?? '?'}`
}

export const FreeAuditoriesResults = ({
  hasProfileIdentity,
  hasQuery,
  isLoading,
  error,
  items,
  generatedAt,
  onRetry,
}: FreeAuditoriesResultsProps) => {
  if (!hasProfileIdentity) {
    return (
        <UniversityTextCard
          className="univer-helper-card"
          title="Нужны данные из профиля"
          subtitle="Для проверки статуса аудиторий добавьте группу или данные преподавателя."
        />
      )
  }

  if (!hasQuery) {
    return (
      <UniversityTextCard
        className="univer-helper-card"
        title="Введите номер аудитории"
        subtitle="Введите номер аудитории, корпус или часть названия. Можно искать по сокращению, которое видно на табличке."
      />
    )
  }

  if (isLoading) {
    return <UniversitySkeletonList />
  }

  if (error) {
    return (
      <UniversityActionCard
        text={error}
        actionLabel="Повторить запрос"
        onAction={onRetry}
      />
    )
  }

  if (items.length === 0) {
    return (
      <UniversityTextCard
        className="univer-empty-card"
        title="Аудитории не найдены"
        subtitle="Попробуйте изменить запрос. Можно искать по номеру, корпусу или части названия."
      />
    )
  }

  const generatedAtLabel = formatGeneratedAt(generatedAt)

  return (
    <section className="univer-results-section">
      {generatedAtLabel && (
        <p className="free-room-generated-at">
          Обновлено в {generatedAtLabel}
        </p>
      )}

      <div className="free-room-list">
        {items.map((room) => (
          <article key={room.id} className="free-room-card">
            <div className="free-room-head">
              <div>
                <h3 className="free-room-title">{room.fullName}</h3>
                <p className="free-room-subtitle">
                  {room.type || 'Аудитория'}
                  {room.department ? ` • ${room.department}` : ''}
                </p>
              </div>

              <span
                className={`free-room-status${
                  room.isBusy ? ' free-room-status--busy' : ''
                }`}
              >
                {room.isBusy ? 'Сейчас занята' : 'Сейчас свободна'}
              </span>
            </div>

            <div className="free-room-tags">
              {room.typeAbbrev && (
                <span className="free-room-tag">{room.typeAbbrev}</span>
              )}
              {room.capacity != null && (
                <span className="free-room-tag">{room.capacity} мест</span>
              )}
              {room.building && (
                <span className="free-room-tag">{room.building}</span>
              )}
            </div>

            {room.note && <p className="free-room-note">{room.note}</p>}

            {room.isBusy ? (
              <div className="free-room-next">
                <span className="free-room-next-label">
                  Текущее занятие
                </span>
                <strong className="free-room-next-value">
                  {formatCurrentLessonLabel(room.currentLesson)}
                </strong>
              </div>
            ) : (
              <div className="free-room-next">
                <span className="free-room-next-label">
                  Следующее занятие
                </span>
                <strong className="free-room-next-value">
                  {formatNextBusyLabel(room.nextBusyLesson)}
                </strong>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
