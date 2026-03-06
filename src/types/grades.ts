export type GradeMark = {
  value: number
  date?: string
}

export type SubjectGrades = {
  id: string
  subject: string
  teacher?: string
  marks: GradeMark[]
}

export type GradesSummary = {
  average?: number
  position?: number
  speciality?: string
}

export type GradesResponse = {
  summary?: GradesSummary
  subjects: SubjectGrades[]
  warning?: string
}
