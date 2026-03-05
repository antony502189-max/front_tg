import { ReactNode } from 'react'
import {
  useLocation,
  useNavigate,
  useOutlet,
} from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BookOpen,
  Building2,
  CalendarDays,
  LayoutGrid,
} from 'lucide-react'

type TabConfig = {
  id: string
  label: string
  path: string
  icon: ReactNode
}

const TABS: TabConfig[] = [
  {
    id: 'planner',
    label: 'Планер',
    path: '/app/planner',
    icon: <LayoutGrid size={20} />,
  },
  {
    id: 'study',
    label: 'Учёба',
    path: '/app/study',
    icon: <BookOpen size={20} />,
  },
  {
    id: 'schedule',
    label: 'Расписание',
    path: '/app/schedule',
    icon: <CalendarDays size={20} />,
  },
  {
    id: 'univer',
    label: 'Универ',
    path: '/app/univer',
    icon: <Building2 size={20} />,
  },
]

export const MainLayout = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const outlet = useOutlet()

  const activeTabId =
    TABS.find((tab) =>
      location.pathname.startsWith(tab.path),
    )?.id ?? 'planner'

  return (
    <div className="main-layout">
      <div className="main-layout-shell">
        <div className="main-layout-content">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{
                duration: 0.18,
                ease: 'easeOut',
              }}
              className="main-layout-panel"
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
        </div>

        <nav className="bottom-nav">
          {TABS.map((tab) => {
            const isActive = tab.id === activeTabId

            return (
              <button
                key={tab.id}
                type="button"
                className={`bottom-nav-item${
                  isActive ? ' bottom-nav-item--active' : ''
                }`}
                onClick={() => {
                  if (!isActive) {
                    navigate(tab.path)
                  }
                }}
              >
                <span className="bottom-nav-icon">
                  {tab.icon}
                </span>
                <span className="bottom-nav-label">
                  {tab.label}
                </span>
              </button>
            )
          })}
        </nav>
      </div>
    </div>
  )
}

