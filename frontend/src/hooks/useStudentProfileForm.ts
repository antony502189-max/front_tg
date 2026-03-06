import {
  useCallback,
  useState,
  type FormEvent,
} from 'react'

export const GROUP_LENGTH = 6
export const STUDENT_CARD_MIN_LENGTH = 4
export const STUDENT_CARD_MAX_LENGTH = 32

type StudentProfilePayload = {
  groupNumber: string
  studentCardNumber: string
}

type UseStudentProfileFormOptions = {
  initialGroupNumber?: string
  initialStudentCardNumber?: string
  onSubmit: (payload: StudentProfilePayload) => void
}

type TouchedState = {
  group: boolean
  card: boolean
}

const defaultTouchedState: TouchedState = {
  group: false,
  card: false,
}

export const useStudentProfileForm = ({
  initialGroupNumber = '',
  initialStudentCardNumber = '',
  onSubmit,
}: UseStudentProfileFormOptions) => {
  const [groupNumber, setGroupNumber] = useState(initialGroupNumber)
  const [studentCardNumber, setStudentCardNumber] = useState(
    initialStudentCardNumber,
  )
  const [touched, setTouched] = useState(defaultTouchedState)

  const isGroupValid = groupNumber.length === GROUP_LENGTH
  const isCardValid =
    studentCardNumber.trim().length >= STUDENT_CARD_MIN_LENGTH
  const isFormValid = isGroupValid && isCardValid

  const updateGroupNumber = useCallback((value: string) => {
    const normalizedValue = value
      .replace(/\D/g, '')
      .slice(0, GROUP_LENGTH)

    setGroupNumber(normalizedValue)
  }, [])

  const updateStudentCardNumber = useCallback((value: string) => {
    setStudentCardNumber(
      value.slice(0, STUDENT_CARD_MAX_LENGTH),
    )
  }, [])

  const markFieldTouched = useCallback((field: keyof TouchedState) => {
    setTouched((currentTouched) =>
      currentTouched[field]
        ? currentTouched
        : {
            ...currentTouched,
            [field]: true,
          },
    )
  }, [])

  const handleSubmit = useCallback((event: FormEvent) => {
    event.preventDefault()
    setTouched({
      group: true,
      card: true,
    })

    if (!isFormValid) {
      return
    }

    onSubmit({
      groupNumber,
      studentCardNumber: studentCardNumber.trim(),
    })
  }, [
    groupNumber,
    isFormValid,
    onSubmit,
    studentCardNumber,
  ])

  return {
    groupNumber,
    studentCardNumber,
    touched,
    isGroupValid,
    isCardValid,
    isFormValid,
    updateGroupNumber,
    updateStudentCardNumber,
    markFieldTouched,
    handleSubmit,
  }
}
