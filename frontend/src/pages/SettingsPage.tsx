import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { useTelegramBackButton } from '../hooks/useTelegramBackButton'
import {
  GROUP_LENGTH,
  STUDENT_CARD_MIN_LENGTH,
  useStudentProfileForm,
} from '../hooks/useStudentProfileForm'
import { useUserStore, type Subgroup } from '../store/userStore'

const SUBGROUP_OPTIONS: { value: Subgroup; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
]

export const SettingsPage = () => {
  const navigate = useNavigate()

  useTelegramBackButton()

  const {
    initialGroupNumber,
    initialCardNumber,
    subgroup,
    setOnboardingData,
    setSubgroup,
    resetUser,
  } = useUserStore(
    useShallow((state) => ({
      initialGroupNumber: state.groupNumber,
      initialCardNumber: state.studentCardNumber,
      subgroup: state.subgroup,
      setOnboardingData: state.setOnboardingData,
      setSubgroup: state.setSubgroup,
      resetUser: state.resetUser,
    })),
  )
  const handleProfileSubmit = useCallback(
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
    },
    [setOnboardingData],
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
    initialGroupNumber,
    initialStudentCardNumber: initialCardNumber,
    onSubmit: handleProfileSubmit,
  })
  const handleReset = useCallback(() => {
    resetUser()
    navigate('/onboarding', { replace: true })
  }, [navigate, resetUser])

  return (
    <div className="planner-page">
      <div className="settings-inner">
        <header className="settings-header">
          <div>
            <h1 className="planner-title">Настройки</h1>
            <p className="planner-subtitle">
              Обновите данные студента и выберите подгруппу.
            </p>
          </div>
        </header>

        <section className="settings-section">
          <h2 className="settings-section-title">Данные студента</h2>
          <form
            className="settings-form"
            onSubmit={handleSubmit}
            noValidate
          >
            <div className="onboarding-field">
              <label
                htmlFor="settings-group"
                className="onboarding-label"
              >
                Учебная группа
              </label>
              <input
                id="settings-group"
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
                  Номер группы должен содержать ровно {GROUP_LENGTH}{' '}
                  цифр.
                </p>
              ) : (
                <p className="onboarding-hint">
                  Только цифры, без букв и пробелов.
                </p>
              )}
            </div>

            <div className="onboarding-field">
              <label
                htmlFor="settings-card"
                className="onboarding-label"
              >
                Номер студенческого
              </label>
              <input
                id="settings-card"
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

            <div className="settings-actions">
              <button
                type="submit"
                className="settings-save-button"
                disabled={!isFormValid}
              >
                Сохранить
              </button>
            </div>
          </form>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">Подгруппа</h2>
          <div className="settings-subgroup-toggle" role="radiogroup">
            {SUBGROUP_OPTIONS.map((item) => {
              const isActive = subgroup === item.value
              return (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  className={`settings-subgroup-button${
                    isActive
                      ? ' settings-subgroup-button--active'
                      : ''
                  }`}
                  onClick={() => setSubgroup(item.value)}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
        </section>

        <section className="settings-section settings-section--danger">
          <h2 className="settings-section-title">Сбросить данные</h2>
          <p className="settings-section-text">
            Очистит сохранённые данные и вернёт вас на экран
            онбординга.
          </p>
          <button
            type="button"
            className="settings-reset-button"
            onClick={handleReset}
          >
            Очистить данные и выйти
          </button>
        </section>
      </div>
    </div>
  )
}

