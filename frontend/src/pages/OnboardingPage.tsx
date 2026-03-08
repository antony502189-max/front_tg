import { useNavigate } from 'react-router-dom'
import { ProfileEditor } from '../components/profile/ProfileEditor'

export const OnboardingPage = () => {
  const navigate = useNavigate()

  return (
    <div className="onboarding-page onboarding-page--profile">
      <div className="onboarding-shell">
        <ProfileEditor
          title="Ваш профиль"
          subtitle="Укажите роль и данные, по которым мы найдём ваши учебные данные."
          submitLabel="Продолжить"
          onSaved={() => navigate('/app/planner', { replace: true })}
        />
      </div>
    </div>
  )
}
