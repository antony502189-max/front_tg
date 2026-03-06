import { useCallback } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import {
  GROUP_LENGTH,
  STUDENT_CARD_MIN_LENGTH,
  useStudentProfileForm,
} from '../hooks/useStudentProfileForm'
import { useUserStore } from '../store/userStore'

export const OnboardingPage = () => {
  const navigate = useNavigate()
  const { existingGroupNumber, existingCardNumber, setOnboardingData } =
    useUserStore(
      useShallow((state) => ({
        existingGroupNumber: state.groupNumber,
        existingCardNumber: state.studentCardNumber,
        setOnboardingData: state.setOnboardingData,
      })),
    )
  const handleFormSubmit = useCallback(
    ({
      groupNumber,
      studentCardNumber,
    }: {
      groupNumber: string
      studentCardNumber: string
    }) => {
      setOnboardingData({
        groupNumber,
        studentCardNumber,
      })
      navigate('/app/planner', { replace: true })
    },
    [navigate, setOnboardingData],
  )
  const {
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
  } = useStudentProfileForm({
    initialGroupNumber: existingGroupNumber,
    initialStudentCardNumber: existingCardNumber,
    onSubmit: handleFormSubmit,
  })

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
                updateGroupNumber(event.target.value)
              }
              onBlur={() => markFieldTouched('group')}
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
                updateStudentCardNumber(event.target.value)
              }
              onBlur={() => markFieldTouched('card')}
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

