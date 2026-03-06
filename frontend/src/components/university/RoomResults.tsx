import { memo } from 'react'
import type { RoomResult } from '../../utils/university'
import { formatUniversityDateLabel } from '../../utils/university'
import {
  UniversityActionCard,
  UniversitySkeletonList,
  UniversityTextCard,
} from './UniversityStateCards'

type RoomResultsProps = {
  hasGroup: boolean
  hasQuery: boolean
  roomResults: RoomResult[]
  scheduleError: string | null
  isScheduleLoading: boolean
  auditoriesError: string | null
  isAuditoriesLoading: boolean
  onRetrySchedule: () => void
  onRetryAuditories: () => void
}

type RoomCardProps = {
  hasGroup: boolean
  isScheduleLoading: boolean
  hasScheduleError: boolean
  room: RoomResult
}

type RoomStatusProps = {
  hasGroup: boolean
  isScheduleLoading: boolean
  hasScheduleError: boolean
  isBusy: boolean
}

const getRoomStatus = ({
  hasGroup,
  isScheduleLoading,
  hasScheduleError,
  isBusy,
}: RoomStatusProps) => {
  if (!hasGroup) {
    return {
      label: 'Нужна группа',
      className: 'univer-room-status univer-room-status--idle',
    }
  }

  if (isScheduleLoading) {
    return {
      label: 'Загружаем',
      className: 'univer-room-status univer-room-status--idle',
    }
  }

  if (hasScheduleError) {
    return {
      label: 'Нет данных',
      className: 'univer-room-status univer-room-status--idle',
    }
  }

  return {
    label: isBusy ? 'Занята сейчас' : 'Свободна сейчас',
    className: `univer-room-status${
      isBusy
        ? ' univer-room-status--busy'
        : ' univer-room-status--free'
    }`,
  }
}

const RoomCard = memo(
  ({
    hasGroup,
    isScheduleLoading,
    hasScheduleError,
    room,
  }: RoomCardProps) => {
    const { auditory, usage, current, next } = room
    const status = getRoomStatus({
      hasGroup,
      isScheduleLoading,
      hasScheduleError,
      isBusy: current !== null,
    })

    return (
      <article className="univer-room-card">
        <div className="univer-room-header">
          <div>
            <h3 className="univer-room-title">
              {auditory.fullName}
            </h3>
            <p className="univer-room-subtitle">
              {auditory.type ?? 'Аудитория'}
              {auditory.department
                ? ` · ${auditory.department}`
                : ''}
            </p>
          </div>

          <span className={status.className}>
            {status.label}
          </span>
        </div>

        <div className="univer-room-meta">
          {auditory.typeAbbrev && (
            <span className="univer-teacher-pill">
              {auditory.typeAbbrev}
            </span>
          )}
          {auditory.capacity != null && (
            <span className="univer-teacher-pill">
              {auditory.capacity} мест
            </span>
          )}
          {auditory.note && (
            <span className="univer-teacher-text">
              {auditory.note}
            </span>
          )}
        </div>

        <div className="univer-room-usage">
          {!hasGroup ? (
            <p className="univer-room-text">
              Чтобы видеть занятость, добавьте группу в
              настройках.
            </p>
          ) : isScheduleLoading ? (
            <p className="univer-room-text">
              Загружаем расписание вашей группы.
            </p>
          ) : usage.length > 0 ? (
            <>
              <p className="univer-room-text">
                {current
                  ? `Сейчас: ${current.lesson.subject}, ${current.lesson.startTime}-${current.lesson.endTime}`
                  : next
                    ? `Следующая пара: ${formatUniversityDateLabel(next.date)}, ${next.lesson.startTime}-${next.lesson.endTime}`
                    : 'На ближайшей неделе по вашему расписанию аудитория свободна.'}
              </p>

              <div className="univer-room-slots">
                {usage.slice(0, 6).map((item) => (
                  <div
                    key={`${auditory.id}-${item.date}-${item.lesson.id}`}
                    className="univer-room-slot"
                  >
                    <span className="univer-room-slot-date">
                      {formatUniversityDateLabel(item.date)}
                    </span>
                    <span className="univer-room-slot-time">
                      {item.lesson.startTime}-{item.lesson.endTime}
                    </span>
                    <span className="univer-room-slot-subject">
                      {item.lesson.subject}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="univer-room-text">
              В расписании вашей группы на текущей неделе эта
              аудитория не используется.
            </p>
          )}
        </div>
      </article>
    )
  },
)

RoomCard.displayName = 'RoomCard'

export const RoomResults = ({
  hasGroup,
  hasQuery,
  roomResults,
  scheduleError,
  isScheduleLoading,
  auditoriesError,
  isAuditoriesLoading,
  onRetrySchedule,
  onRetryAuditories,
}: RoomResultsProps) => {
  if (scheduleError) {
    return (
      <UniversityActionCard
        text={scheduleError}
        actionLabel="Перезагрузить расписание"
        onAction={onRetrySchedule}
      />
    )
  }

  if (isAuditoriesLoading) {
    return <UniversitySkeletonList />
  }

  if (hasQuery && auditoriesError) {
    return (
      <UniversityActionCard
        text={auditoriesError}
        actionLabel="Повторить попытку"
        onAction={onRetryAuditories}
      />
    )
  }

  return (
    <section className="univer-results-section">
      {!hasGroup && (
        <UniversityTextCard
          className="univer-helper-card"
          title="Добавьте учебную группу"
          subtitle="Тогда мы сможем показать занятость аудиторий по вашему расписанию."
        />
      )}

      {hasQuery ? (
        roomResults.length > 0 ? (
          <div className="univer-room-list">
            {roomResults.map((room) => (
              <RoomCard
                key={room.auditory.id}
                hasGroup={hasGroup}
                isScheduleLoading={isScheduleLoading}
                hasScheduleError={scheduleError !== null}
                room={room}
              />
            ))}
          </div>
        ) : (
          <UniversityTextCard
            className="univer-empty-card"
            title="Аудитории не найдены"
            subtitle="Попробуйте ввести номер аудитории или корпус иначе."
          />
        )
      ) : (
        <UniversityTextCard
          className="univer-helper-card"
          title="Найдите аудиторию"
          subtitle="Можно искать по номеру аудитории или по корпусу, а затем смотреть её занятость по расписанию вашей группы."
        />
      )}
    </section>
  )
}
