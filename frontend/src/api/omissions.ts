import { apiGet, LONG_API_TIMEOUT_MS } from './client'

export type OmissionMonth = {
  month: string
  omissionCount: number
}

export type OmissionsResponse = {
  totalHours: number
  months: OmissionMonth[]
}

const OMISSIONS_API_TIMEOUT_MS = LONG_API_TIMEOUT_MS * 2

const toNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const normalized = Number(value.replace(',', '.').trim())
    return Number.isFinite(normalized) ? normalized : 0
  }

  return 0
}

export async function fetchOmissions(
  telegramUserId: string,
  options: {
    signal?: AbortSignal
  } = {},
): Promise<OmissionsResponse> {
  const payload = await apiGet<
    OmissionsResponse & Record<string, unknown>
  >('/omissions', {
    params: {
      telegramUserId: telegramUserId.trim(),
    },
    timeout: OMISSIONS_API_TIMEOUT_MS,
    signal: options.signal,
    cacheTtlMs: 60_000,
  })

  const months = Array.isArray(payload.months)
    ? payload.months
        .filter((item) => !!item && typeof item === 'object')
        .map((item) => {
          const record = item as Record<string, unknown>
          const month =
            typeof record.month === 'string'
              ? record.month.trim()
              : ''

          return {
            month,
            omissionCount: toNumber(record.omissionCount),
          }
        })
        .filter((item) => item.month.length > 0)
    : []

  return {
    totalHours: toNumber(payload.totalHours),
    months,
  }
}
