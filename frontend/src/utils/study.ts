import type { GradesResponse } from '../api/grades'

export type SubjectRating = {
  id: string
  subject: string
  teacher: string | undefined
  average: number
  marksCount: number
}

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

export const buildSubjectRating = (
  subjects: GradesResponse['subjects'],
): SubjectRating[] => {
  const rating: SubjectRating[] = []

  for (const subject of subjects) {
    let total = 0
    let marksCount = 0

    for (const mark of subject.marks) {
      if (!Number.isFinite(mark.value)) {
        continue
      }

      total += mark.value
      marksCount += 1
    }

    if (!marksCount) {
      continue
    }

    rating.push({
      id: subject.id,
      subject: subject.subject,
      teacher: subject.teacher,
      average: total / marksCount,
      marksCount,
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

  return rating
}
