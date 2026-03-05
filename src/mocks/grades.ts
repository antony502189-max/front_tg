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
}

const MOCK_GRADES: GradesResponse = {
  summary: {
    average: 8.7,
    position: 12,
    speciality: 'СиСИ',
  },
  subjects: [
    {
      id: 'math',
      subject: 'Высшая математика',
      teacher: 'Иванов И.И.',
      marks: [
        { value: 9, date: '2025-09-15' },
        { value: 8, date: '2025-10-01' },
        { value: 10, date: '2025-11-20' },
      ],
    },
    {
      id: 'oop',
      subject: 'Объектно-ориентированное программирование',
      teacher: 'Петров П.П.',
      marks: [
        { value: 8, date: '2025-09-20' },
        { value: 9, date: '2025-10-10' },
        { value: 9, date: '2025-11-25' },
      ],
    },
    {
      id: 'physics',
      subject: 'Физика',
      teacher: 'Сидорова С.С.',
      marks: [
        { value: 7, date: '2025-09-18' },
        { value: 8, date: '2025-10-05' },
        { value: 8, date: '2025-11-18' },
      ],
    },
  ],
}

export function getMockGrades(_studentCardNumber: string): GradesResponse {
  return MOCK_GRADES
}

