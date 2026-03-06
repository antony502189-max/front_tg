import { useMemo, useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useUserStore } from '../store/userStore'

const GROUP_LENGTH = 6
const STUDENT_CARD_MIN_LENGTH = 4
const STUDENT_CARD_MAX_LENGTH = 32

export const OnboardingPage = () => {
  const navigate = useNavigate()
  const existingGroupNumber = useUserStore(
    (state) => state.groupNumber,
  )
  const existingCardNumber = useUserStore(
    (state) => state.studentCardNumber,
  )
  const setOnboardingData = useUserStore(
    (state) => state.setOnboardingData,
  )

  const [groupNumber, setGroupNumber] = useState(
    existingGroupNumber ?? '',
  )
  const [studentCardNumber, setStudentCardNumber] = useState(
    existingCardNumber ?? '',
  )
  const [touched, setTouched] = useState({
    group: false,
    card: false,
  })

  const isGroupValid = useMemo(
    () => groupNumber.length === GROUP_LENGTH,
    [groupNumber],
  )
  const isCardValid = useMemo(
    () =>
      studentCardNumber.trim().length >= STUDENT_CARD_MIN_LENGTH,
    [studentCardNumber],
  )
  const isFormValid = isGroupValid && isCardValid

  const handleGroupChange = (value: string) => {
    const numeric = value.replace(/\D/g, '').slice(0, GROUP_LENGTH)
    setGroupNumber(numeric)
  }

  const handleCardChange = (value: string) => {
    setStudentCardNumber(value.slice(0, STUDENT_CARD_MAX_LENGTH))
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    setTouched({ group: true, card: true })

    if (!isFormValid) {
      return
    }

    setOnboardingData({
      groupNumber,
      studentCardNumber,
    })
    navigate('/app/planner', { replace: true })
  }

  return (
    <div className="onboarding-page">
      <motion.div
        className="onboarding-card"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
      >
        <div className="onboarding-header">
          <h1 className="onboarding-title">Добро пожаловать</h1>
          <p className="onboarding-subtitle">
            Введите данные, чтобы мы могли подгрузить ваше
            расписание и успеваемость.
          </p>
        </div>

        <form
          className="onboarding-form"
          onSubmit={handleSubmit}
          noValidate
        >
          <div className="onboarding-field">
            <label
              htmlFor="group"
              className="onboarding-label"
            >
              Учебная группа
            </label>
            <input
              id="group"
              inputMode="numeric"
              autoComplete="off"
              className={`onboarding-input${
                touched.group && !isGroupValid
                  ? ' onboarding-input--error'
                  : ''
              }`}
              placeholder="Например, 123456"
              value={groupNumber}
              onChange={(event) =>
                handleGroupChange(event.target.value)
              }
              onBlur={() =>
                setTouched((prev) => ({ ...prev, group: true }))
              }
            />
            {touched.group && !isGroupValid ? (
              <p className="onboarding-error">
                Номер группы должен содержать ровно{' '}
                {GROUP_LENGTH} цифр.
              </p>
            ) : (
              <p className="onboarding-hint">
                Только цифры, без букв и пробелов.
              </p>
            )}
          </div>

          <div className="onboarding-field">
            <label
              htmlFor="card"
              className="onboarding-label"
            >
              Номер студенческого
            </label>
            <input
              id="card"
              inputMode="text"
              autoComplete="off"
              className={`onboarding-input${
                touched.card && !isCardValid
                  ? ' onboarding-input--error'
                  : ''
              }`}
              placeholder="Как в IIS, например 12345678"
              value={studentCardNumber}
              onChange={(event) =>
                handleCardChange(event.target.value)
              }
              onBlur={() =>
                setTouched((prev) => ({ ...prev, card: true }))
              }
            />
            {touched.card && !isCardValid ? (
              <p className="onboarding-error">
                Введите номер студенческого как минимум из{' '}
                {STUDENT_CARD_MIN_LENGTH} символов.
              </p>
            ) : (
              <p className="onboarding-hint">
                Можно вводить так же, как номер записан в IIS.
              </p>
            )}
          </div>

          <button
            type="submit"
            className="onboarding-submit"
            disabled={!isFormValid}
          >
            Начать
          </button>
        </form>
      </motion.div>
    </div>
  )
}

