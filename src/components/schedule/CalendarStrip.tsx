import type { DaySchedule } from '../../api/schedule'

type CalendarStripProps = {
  days: DaySchedule[]
  selectedDate: string
  onSelectDate: (date: string) => void
}

const formatWeekday = (dateString: string) => {
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleDateString('ru-RU', {
    weekday: 'short',
  })
}

const getDayNumber = (dateString: string) => {
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.getDate()
}

export const CalendarStrip = ({
  days,
  selectedDate,
  onSelectDate,
}: CalendarStripProps) => {
  const todayKey = new Date().toISOString().slice(0, 10)

  return (
    <div className="schedule-calendar-strip">
      {days.map((day) => {
        const isSelected = day.date === selectedDate
        const isToday = day.date === todayKey

        return (
          <button
            key={day.date}
            type="button"
            className={`schedule-day-chip${
              isSelected ? ' schedule-day-chip--selected' : ''
            }`}
            onClick={() => onSelectDate(day.date)}
          >
            <span className="schedule-day-weekday">
              {formatWeekday(day.date)}
            </span>
            <span className="schedule-day-number">
              {getDayNumber(day.date)}
            </span>
            {isToday && (
              <span className="schedule-day-today-dot" aria-hidden="true" />
            )}
          </button>
        )
      })}
    </div>
  )
}

