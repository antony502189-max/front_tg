import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { deleteUserProfile } from '../api/profile'
import { ProfileEditor } from '../components/profile/ProfileEditor'
import { useTelegramBackButton } from '../hooks/useTelegramBackButton'
import { useUserStore } from '../store/userStore'
import { resolveSessionUserId } from '../telegram/session'

export const SettingsPage = () => {
  const navigate = useNavigate()
  const [isResetting, setIsResetting] = useState(false)
  const { role, resetUser } = useUserStore(
    useShallow((state) => ({
      role: state.role,
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
          subtitle="Обновите персональные и учебные параметры в профиле."
          submitLabel="Сохранить профиль"
        />

        {role === 'teacher' && (
          <section className="settings-section">
            <h2 className="settings-section-title">Роль преподавателя</h2>
            <p className="settings-section-text">
              Заполните все поля. Они нужны
              для поиска преподавателя и загрузки расписания.
            </p>
          </section>
        )}

        <section className="settings-section settings-section--danger">
          <h2 className="settings-section-title">Сброс профиля</h2>
          <p className="settings-section-text">
            Удалит локальные данные и профиль, после чего вам опять
            придётся пройти регистрацию.
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
