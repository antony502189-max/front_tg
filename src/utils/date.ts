const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

const padDatePart = (value: number) => String(value).padStart(2, '0')

export const toDateKey = (date: Date): string => {
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('-')
}

export const parseDateKey = (value: string): Date | null => {
  const match = DATE_KEY_PATTERN.exec(value)

  if (!match) {
    return null
  }

  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  const parsed = new Date(year, monthIndex, day)

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== monthIndex ||
    parsed.getDate() !== day
  ) {
    return null
  }

  return parsed
}

export const buildDateTime = (
  dateKey: string,
  time: string,
): Date | null => {
  const date = parseDateKey(dateKey)

  if (!date) {
    return null
  }

  const [rawHour, rawMinute] = time.split(':')
  const hour = Number(rawHour)
  const minute = Number(rawMinute)

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null
  }

  date.setHours(hour, minute, 0, 0)
  return date
}
