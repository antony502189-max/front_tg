import type { GradeMark, GradesResponse } from '../api/grades'

export type SubjectRating = {
  id: string
  subject: string
  teacher: string | undefined
  average: number
  marksCount: number
}

export type StudyMarkGroupKey = 'practice' | 'lab' | 'lecture' | 'other'

export type StudyMarkGroup = {
  key: StudyMarkGroupKey
  label: string
  marks: GradeMark[]
}

export type StudySubjectSummary =
  GradesResponse['subjects'][number] & {
    average: number | null
    marksCount: number
    hasTypedMarks: boolean
    markGroups: StudyMarkGroup[]
  }

export type StudyOverview = {
  subjectSummaries: StudySubjectSummary[]
  rating: SubjectRating[]
}

const normalizeStudyMarkType = (value: string | undefined) =>
  (value ?? '').trim().toLowerCase().replace(/\s+/g, '')

const getStudyMarkGroupKey = (
  value: string | undefined,
): StudyMarkGroupKey => {
  const normalized = normalizeStudyMarkType(value)

  if (
    normalized.startsWith('пз') ||
    normalized.startsWith('практик') ||
    normalized.startsWith('сем') ||
    normalized.startsWith('сз')
  ) {
    return 'practice'
  }

  if (
    normalized.startsWith('лр') ||
    normalized.startsWith('лб') ||
    normalized.startsWith('лаб')
  ) {
    return 'lab'
  }

  if (normalized.startsWith('лк') || normalized.startsWith('лек')) {
    return 'lecture'
  }

  return 'other'
}

const getStudyMarkGroupLabel = (value: string | undefined, key: string) => {
  const normalized = normalizeStudyMarkType(value)

  if (key === 'practice') {
    return 'ПЗ'
  }

  if (key === 'lab') {
    if (normalized.startsWith('лр')) {
      return 'ЛР'
    }

    return 'ЛБ'
  }

  if (key === 'lecture') {
    return 'ЛК'
  }

  return 'Оценки'
}

const STUDY_MARK_GROUP_ORDER: StudyMarkGroupKey[] = [
  'practice',
  'lab',
  'lecture',
  'other',
]

export const formatMarksLabel = (count: number) => {
  const remainder100 = count % 100

  if (remainder100 >= 11 && remainder100 <= 14) {
    return 'оценок'
  }

  const remainder10 = count % 10

  if (remainder10 === 1) {
    return 'оценка'
  }

  if (remainder10 >= 2 && remainder10 <= 4) {
    return 'оценки'
  }

  return 'оценок'
}

const buildStudySubjectSummary = (
  subject: GradesResponse['subjects'][number],
): StudySubjectSummary => {
  let total = 0
  let marksCount = 0
  let hasTypedMarks = false
  const groups: Partial<Record<StudyMarkGroupKey, StudyMarkGroup>> = {}

  for (const mark of subject.marks) {
    if (Number.isFinite(mark.value)) {
      total += mark.value
      marksCount += 1
    }

    const key = getStudyMarkGroupKey(mark.type)
    let group = groups[key]

    if (group === undefined) {
      group = {
        key,
        label: getStudyMarkGroupLabel(mark.type, key),
        marks: [],
      }
      groups[key] = group
    }

    group.marks.push(mark)

    if (key !== 'other') {
      hasTypedMarks = true
    }
  }

  const average = marksCount > 0 ? total / marksCount : null
  const markGroups = STUDY_MARK_GROUP_ORDER.flatMap((key) => {
    const group = groups[key]
    return group === undefined ? [] : [group]
  })

  return {
    ...subject,
    average,
    marksCount,
    hasTypedMarks,
    markGroups,
  }
}

export const buildStudyOverview = (
  subjects: GradesResponse['subjects'],
): StudyOverview => {
  const subjectSummaries: StudySubjectSummary[] = []
  const rating: SubjectRating[] = []

  for (const subject of subjects) {
    const subjectSummary = buildStudySubjectSummary(subject)

    subjectSummaries.push(subjectSummary)

    if (subjectSummary.average === null) {
      continue
    }

    rating.push({
      id: subjectSummary.id,
      subject: subjectSummary.subject,
      teacher: subjectSummary.teacher,
      average: subjectSummary.average,
      marksCount: subjectSummary.marksCount,
    })
  }

  rating.sort((left, right) => {
    if (right.average !== left.average) {
      return right.average - left.average
    }

    if (right.marksCount !== left.marksCount) {
      return right.marksCount - left.marksCount
    }

    return left.subject.localeCompare(right.subject, 'ru')
  })

  return {
    subjectSummaries,
    rating,
  }
}
