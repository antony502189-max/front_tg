import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { deleteUserProfile } from '../api/profile'
import { ProfileEditor } from '../components/profile/ProfileEditor'
import { useTelegramBackButton } from '../hooks/useTelegramBackButton'
import { useUserStore, type Subgroup } from '../store/userStore'
import { resolveSessionUserId } from '../telegram/session'

const SUBGROUP_OPTIONS: Array<{ value: Subgroup; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
]

export const SettingsPage = () => {
  const navigate = useNavigate()
  const [isResetting, setIsResetting] = useState(false)
  const { role, subgroup, setSubgroup, resetUser } = useUserStore(
    useShallow((state) => ({
      role: state.role,
      subgroup: state.subgroup,
      setSubgroup: state.setSubgroup,
      resetUser: state.resetUser,
    })),
  )

  useTelegramBackButton({ to: '/app/planner' })

  const handleReset = async () => {
    if (isResetting) {
      return
    }

    setIsResetting(true)

    try {
      await deleteUserProfile(resolveSessionUserId())
    } catch {
      // Local reset should still happen even if backend profile deletion fails.
    } finally {
      resetUser()
      navigate('/onboarding', { replace: true })
    }
  }

  return (
    <div className="planner-page">
      <div className="settings-inner settings-inner--modern">
        <header className="settings-header">
          <div>
            <h1 className="planner-title">Настройки</h1>
            <p className="planner-subtitle">
              Управляйте профилем, который используется для загрузки данных, и
              персонализацией интерфейса.
            </p>
          </div>
        </header>

        <ProfileEditor
          title="Профиль"
          subtitle="Обновите персональные и учебные параметры в backend-профиле."
          submitLabel="Сохранить профиль"
        />

        {role === 'student' && (
          <section className="settings-section">
            <h2 className="settings-section-title">Подгруппа</h2>
            <p className="settings-section-text">
              Используется для отображения подгрупп, если в расписании пары
              разделены по подгруппам.
            </p>
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
                      isActive ? ' settings-subgroup-button--active' : ''
                    }`}
                    onClick={() => setSubgroup(item.value)}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {role === 'teacher' && (
          <section className="settings-section">
            <h2 className="settings-section-title">Роль преподавателя</h2>
            <p className="settings-section-text">
              Для преподавателя важны поля `employeeId` и `urlId`. Они нужны
              для поиска преподавателя и загрузки расписания через backend.
            </p>
          </section>
        )}

        <section className="settings-section settings-section--danger">
          <h2 className="settings-section-title">Сброс профиля</h2>
          <p className="settings-section-text">
            Удалит локальные данные и backend-профиль, после чего вас снова
            попросят пройти onboarding.
          </p>
          <button
            type="button"
            className="settings-reset-button"
            onClick={handleReset}
            disabled={isResetting}
          >
            {isResetting ? 'Сбрасываем...' : 'Сбросить профиль и выйти'}
          </button>
        </section>
      </div>
    </div>
  )
}
