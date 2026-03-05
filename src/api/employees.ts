import { apiClient } from './client'

export type Employee = {
  id: string
  fullName: string
  position?: string
  department?: string
  avatarUrl?: string
}

type RawEmployee = {
  id?: string | number
  fio?: string
  firstName?: string
  lastName?: string
  middleName?: string
  academicDepartment?: string
  photoLink?: string
  rank?: string
  position?: string
  [key: string]: unknown
}

const FALLBACK_EMPLOYEE_NAME = 'Преподаватель'

function buildFullName(raw: RawEmployee): string {
  if (typeof raw.fio === 'string' && raw.fio.trim().length > 0) {
    return raw.fio.trim()
  }

  const parts = [
    raw.lastName,
    raw.firstName,
    raw.middleName,
  ].filter((part): part is string => typeof part === 'string' && part.length > 0)

  if (parts.length > 0) {
    return parts.join(' ')
  }

  return FALLBACK_EMPLOYEE_NAME
}

export async function searchTeachers(query: string): Promise<Employee[]> {
  const trimmed = query.trim()

  if (!trimmed) {
    return []
  }

  const response = await apiClient.get<RawEmployee[]>('/employees', {
    params: { q: trimmed },
  })

  const raw = response.data ?? []

  return raw.map((employee) => {
    const fullName = buildFullName(employee)

    const position =
      typeof employee.position === 'string' && employee.position.length > 0
        ? employee.position
        : typeof employee.rank === 'string' && employee.rank.length > 0
          ? employee.rank
          : undefined

    const department =
      typeof employee.academicDepartment === 'string' &&
      employee.academicDepartment.length > 0
        ? employee.academicDepartment
        : undefined

    const avatarUrl =
      typeof employee.photoLink === 'string' && employee.photoLink.length > 0
        ? employee.photoLink
        : undefined

    return {
      id: String(employee.id ?? fullName),
      fullName,
      position,
      department,
      avatarUrl,
    }
  })
}

