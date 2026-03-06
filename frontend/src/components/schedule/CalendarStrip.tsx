import { memo, useMemo } from 'react'
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

export const CalendarStrip = memo(({
  days,
  selectedDate,
  onSelectDate,
}: CalendarStripProps) => {
  const todayKey = toDateKey(new Date())
  const dayItems = useMemo(
    () =>
      days.map((day) => ({
        ...day,
        weekday: formatWeekday(day.date),
        dayNumber: getDayNumber(day.date),
      })),
    [days],
  )

  return (
    <div className="schedule-calendar-strip">
      {dayItems.map((day) => {
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
              {day.weekday}
            </span>
            <span className="schedule-day-number">
              {day.dayNumber}
            </span>
            {isToday && (
              <span className="schedule-day-today-dot" aria-hidden="true" />
            )}
          </button>
        )
      })}
    </div>
  )
})

CalendarStrip.displayName = 'CalendarStrip'

