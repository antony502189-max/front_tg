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
import { useShallow } from 'zustand/react/shallow'
import { useTelegramTheme } from './hooks/useTelegramTheme'
import { fetchUserProfile, saveUserProfile } from './api/profile'
import { resolveSessionContext } from './telegram/session'
import { useUserStore } from './store/userStore'
import { MainLayout } from './layouts/MainLayout'
import type { UserProfile } from './types/user'

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

type FallbackProfileState = {
  role: UserProfile['role'] | null
  subgroup: UserProfile['subgroup']
  groupNumber: string
  studentCardNumber: string
  iisLogin: string
  employeeId: string
  urlId: string
  fullName: string
  position: string
  department: string
  avatarUrl: string
  isOnboarded: boolean
}

const buildFallbackProfilePayload = (
  sessionUserId: string,
  previousSessionUserId: string | null,
  state: FallbackProfileState,
): UserProfile | null => {
  if (!state.isOnboarded || !state.role) {
    return null
  }

  const normalizedPreviousSessionUserId =
    previousSessionUserId?.trim() || undefined

  if (state.role === 'student') {
    const groupNumber = state.groupNumber.trim()
    const iisLogin = state.iisLogin.trim()
    const studentCardNumber =
      state.studentCardNumber.trim() || iisLogin

    if (!groupNumber || !studentCardNumber) {
      return null
    }

    return {
      telegramUserId: sessionUserId,
      previousTelegramUserId: normalizedPreviousSessionUserId,
      role: 'student',
      subgroup: state.subgroup,
      groupNumber,
      studentCardNumber,
      iisLogin: iisLogin || undefined,
    }
  }

  const employeeId = state.employeeId.trim()
  const urlId = state.urlId.trim()
  const fullName = state.fullName.trim()

  if (!employeeId || !urlId || !fullName) {
    return null
  }

  return {
    telegramUserId: sessionUserId,
    previousTelegramUserId: normalizedPreviousSessionUserId,
    role: 'teacher',
    subgroup: state.subgroup,
    employeeId,
    urlId,
    fullName,
    position: state.position.trim() || undefined,
    department: state.department.trim() || undefined,
    avatarUrl: state.avatarUrl.trim() || undefined,
  }
}

type RequireOnboardedProps = {
  children: ReactElement
}

const RequireOnboarded = ({ children }: RequireOnboardedProps) => {
  const isOnboarded = useUserStore((state) => state.isOnboarded)
  const isProfileBootstrapped = useUserStore(
    (state) => state.isProfileBootstrapped,
  )
  const location = useLocation()

  if (!isProfileBootstrapped) {
    return <RouteFallback />
  }

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

type RequireStudentProps = {
  children: ReactElement
}

const RequireStudent = ({ children }: RequireStudentProps) => {
  const role = useUserStore((state) => state.role)
  const isProfileBootstrapped = useUserStore(
    (state) => state.isProfileBootstrapped,
  )

  if (!isProfileBootstrapped) {
    return <RouteFallback />
  }

  if (role !== 'student') {
    return <Navigate to="/app/planner" replace />
  }

  return children
}

function App() {
  const theme = useTelegramTheme()
  const {
    role,
    subgroup,
    groupNumber,
    studentCardNumber,
    iisLogin,
    employeeId,
    urlId,
    fullName,
    position,
    department,
    avatarUrl,
    isOnboarded,
    isProfileBootstrapped,
    applyUserProfile,
    markProfileBootstrapped,
  } = useUserStore(
    useShallow((state) => ({
      role: state.role,
      subgroup: state.subgroup,
      groupNumber: state.groupNumber,
      studentCardNumber: state.studentCardNumber,
      iisLogin: state.iisLogin,
      employeeId: state.employeeId,
      urlId: state.urlId,
      fullName: state.fullName,
      position: state.position,
      department: state.department,
      avatarUrl: state.avatarUrl,
      isOnboarded: state.isOnboarded,
      isProfileBootstrapped: state.isProfileBootstrapped,
      applyUserProfile: state.applyUserProfile,
      markProfileBootstrapped: state.markProfileBootstrapped,
    })),
  )
  const hasLocalProfile = isOnboarded && role !== null

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

  useEffect(() => {
    if (!isProfileBootstrapped && hasLocalProfile) {
      markProfileBootstrapped()
    }
  }, [hasLocalProfile, isProfileBootstrapped, markProfileBootstrapped])

  useEffect(() => {
    const controller = new AbortController()
    const { sessionUserId, previousSessionUserId } =
      resolveSessionContext()
    const fallbackProfilePayload = buildFallbackProfilePayload(
      sessionUserId,
      previousSessionUserId,
      {
        role,
        subgroup,
        groupNumber,
        studentCardNumber,
        iisLogin,
        employeeId,
        urlId,
        fullName,
        position,
        department,
        avatarUrl,
        isOnboarded,
      },
    )

    void (async () => {
      try {
        const profile = await fetchUserProfile(
          sessionUserId,
          controller.signal,
        )
        if (controller.signal.aborted) {
          return
        }

        if (profile) {
          applyUserProfile(profile)
          return
        }

        if (fallbackProfilePayload) {
          const restoredProfile = await saveUserProfile(
            fallbackProfilePayload,
          )
          if (!controller.signal.aborted) {
            applyUserProfile(restoredProfile)
          }
          return
        }

        markProfileBootstrapped()
      } catch {
        if (!controller.signal.aborted) {
          markProfileBootstrapped()
        }
      }
    })()

    return () => {
      controller.abort()
    }
  }, [
    applyUserProfile,
    avatarUrl,
    department,
    employeeId,
    fullName,
    groupNumber,
    iisLogin,
    isOnboarded,
    markProfileBootstrapped,
    position,
    role,
    studentCardNumber,
    subgroup,
    urlId,
  ])

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
            <Route
              path="study"
              element={
                <RequireStudent>
                  <StudyPage />
                </RequireStudent>
              }
            />
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="univer" element={<UniversityPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route
            path="*"
            element={
              !isProfileBootstrapped ? (
                <RouteFallback />
              ) : isOnboarded ? (
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
