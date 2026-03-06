import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTelegramBackButton } from '../hooks/useTelegramBackButton'
import { useUserStore, type Subgroup } from '../store/userStore'

const GROUP_LENGTH = 6
const STUDENT_CARD_MIN_LENGTH = 4
const STUDENT_CARD_MAX_LENGTH = 32

export const SettingsPage = () => {
  const navigate = useNavigate()

  useTelegramBackButton()

  const initialGroupNumber = useUserStore((state) => state.groupNumber)
  const initialCardNumber = useUserStore(
    (state) => state.studentCardNumber,
  )
  const subgroup = useUserStore((state) => state.subgroup)
  const setOnboardingData = useUserStore(
    (state) => state.setOnboardingData,
  )
  const setSubgroup = useUserStore((state) => state.setSubgroup)
  const resetUser = useUserStore((state) => state.resetUser)

  const [groupNumber, setGroupNumber] = useState(
    initialGroupNumber ?? '',
  )
  const [studentCardNumber, setStudentCardNumber] = useState(
    initialCardNumber ?? '',
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
  }

  const handleSubgroupChange = (value: Subgroup) => {
    setSubgroup(value)
  }

  const handleReset = () => {
    resetUser()
    navigate('/onboarding', { replace: true })
  }

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
                  handleGroupChange(event.target.value)
                }
                onBlur={() =>
                  setTouched((prev) => ({ ...prev, group: true }))
                }
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
            {([
              { value: 'all', label: 'Все' },
              { value: '1', label: '1' },
              { value: '2', label: '2' },
            ] as { value: Subgroup; label: string }[]).map((item) => {
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
                  onClick={() => handleSubgroupChange(item.value)}
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

