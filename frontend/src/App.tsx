import { useEffect, type ReactElement } from 'react'
import {
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'
import { useTelegramTheme } from './hooks/useTelegramTheme'
import { useUserStore } from './store/userStore'
import { OnboardingPage } from './pages/OnboardingPage'
import { PlannerPage } from './pages/PlannerPage'
import { StudyPage } from './pages/StudyPage'
import { SchedulePage } from './pages/SchedulePage'
import { UniversityPage } from './pages/UniversityPage'
import { MainLayout } from './layouts/MainLayout'
import { SettingsPage } from './pages/SettingsPage'

type RequireOnboardedProps = {
  children: ReactElement
}

const RequireOnboarded = ({ children }: RequireOnboardedProps) => {
  const isOnboarded = useUserStore((state) => state.isOnboarded)
  const location = useLocation()

  if (!isOnboarded) {
    return (
      <Navigate
        to="/onboarding"
        state={{ from: location }}
        replace
      />
    )
  }

  return children
}

function App() {
  const theme = useTelegramTheme()
  const isOnboarded = useUserStore((state) => state.isOnboarded)

  useEffect(() => {
    const root = document.documentElement

    root.style.setProperty('--tg-bg-color', theme.bgColor)
    root.style.setProperty('--tg-text-color', theme.textColor)
    root.style.setProperty('--tg-hint-color', theme.hintColor)
    root.style.setProperty('--tg-link-color', theme.linkColor)
    root.style.setProperty('--tg-button-color', theme.buttonColor)
    root.style.setProperty(
      '--tg-button-text-color',
      theme.buttonTextColor,
    )
    root.style.setProperty(
      '--tg-secondary-bg-color',
      theme.secondaryBgColor,
    )
    root.style.setProperty(
      'color-scheme',
      theme.isDark ? 'dark' : 'light',
    )
  }, [theme])

  return (
    <div className="app-root">
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route
          path="/app/*"
          element={
            <RequireOnboarded>
              <MainLayout />
            </RequireOnboarded>
          }
        >
          <Route
            index
            element={<Navigate to="planner" replace />}
          />
          <Route path="planner" element={<PlannerPage />} />
          <Route path="study" element={<StudyPage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="univer" element={<UniversityPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route
          path="*"
          element={
            isOnboarded ? (
              <Navigate to="/app/planner" replace />
            ) : (
              <Navigate to="/onboarding" replace />
            )
          }
        />
      </Routes>
    </div>
  )
}

export default App
