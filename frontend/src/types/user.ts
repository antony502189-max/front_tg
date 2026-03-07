export type UserRole = 'student' | 'teacher'
export type Subgroup = 'all' | '1' | '2'

export type UserProfile = {
  telegramUserId?: string
  role: UserRole
  subgroup?: Subgroup
  groupNumber?: string
  studentCardNumber?: string
  employeeId?: string
  urlId?: string
  fullName?: string
  position?: string
  department?: string
  avatarUrl?: string
  updatedAt?: string
}

export type EmployeeSearchResult = {
  id: string
  employeeId: string
  urlId: string
  fullName: string
  position?: string
  department?: string
  avatarUrl?: string
}

export type FreeAuditoryNextLesson = {
  subject?: string
  date?: string
  startTime?: string
  endTime?: string
}

export type FreeAuditory = {
  id: string
  name: string
  building?: string
  fullName: string
  type?: string
  typeAbbrev?: string
  capacity?: number | null
  department?: string
  note?: string
  nextBusyLesson?: FreeAuditoryNextLesson | null
}
