import {
  Suspense,
  lazy,
  useEffect,
  type ReactElement,
} from 'react'
import {
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'
import { useTelegramTheme } from './hooks/useTelegramTheme'
import { useUserStore } from './store/userStore'
import { MainLayout } from './layouts/MainLayout'

const OnboardingPage = lazy(() =>
  import('./pages/OnboardingPage').then((module) => ({
    default: module.OnboardingPage,
  })),
)
const PlannerPage = lazy(() =>
  import('./pages/PlannerPage').then((module) => ({
    default: module.PlannerPage,
  })),
)
const StudyPage = lazy(() =>
  import('./pages/StudyPage').then((module) => ({
    default: module.StudyPage,
  })),
)
const SchedulePage = lazy(() =>
  import('./pages/SchedulePage').then((module) => ({
    default: module.SchedulePage,
  })),
)
const UniversityPage = lazy(() =>
  import('./pages/UniversityPage').then((module) => ({
    default: module.UniversityPage,
  })),
)
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({
    default: module.SettingsPage,
  })),
)

const RouteFallback = () => (
  <div className="app-route-fallback" aria-hidden="true" />
)

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
      <Suspense fallback={<RouteFallback />}>
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
      </Suspense>
    </div>
  )
}

export default App
