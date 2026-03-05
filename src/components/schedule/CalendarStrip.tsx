import type { DaySchedule } from '../../api/schedule'
import { parseDateKey, toDateKey } from '../../utils/date'

const weekdayFormatter = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short',
})

type CalendarStripProps = {
  days: DaySchedule[]
  selectedDate: string
  onSelectDate: (date: string) => void
}

const formatWeekday = (dateString: string) => {
  const date = parseDateKey(dateString)
  if (!date) {
    return ''
  }

  return weekdayFormatter.format(date)
}

const getDayNumber = (dateString: string) => {
  const date = parseDateKey(dateString)
  if (!date) {
    return ''
  }

  return date.getDate()
}

export const CalendarStrip = ({
  days,
  selectedDate,
  onSelectDate,
}: CalendarStripProps) => {
  const todayKey = toDateKey(new Date())

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

