import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ProfileEditor } from '../components/profile/ProfileEditor'

export const OnboardingPage = () => {
  const navigate = useNavigate()

  return (
    <div className="onboarding-page onboarding-page--profile">
      <motion.div
        className="onboarding-shell"
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.24, ease: 'easeOut' }}
      >
        <section className="onboarding-intro">
          <span className="onboarding-kicker">BSUIR Nexus</span>
          <p className="onboarding-lead">
            Заполните профиль в несколько шагов. После этого приложение сможет
            подгружать персональные данные, которые нужны для учебных сервисов
            от backend.
          </p>
        </section>

        <ProfileEditor
          title="Ваш профиль"
          subtitle="Укажите роль и данные, по которым backend найдёт ваши учебные данные."
          submitLabel="Продолжить"
          onSaved={() => navigate('/app/planner', { replace: true })}
        />
      </motion.div>
    </div>
  )
}
