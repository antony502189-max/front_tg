import type { ReactNode } from 'react'
import {
  BookOpen,
  Building2,
  CalendarDays,
  LayoutGrid,
  Settings2,
} from 'lucide-react'
import {
  useLocation,
  useNavigate,
  useOutlet,
} from 'react-router-dom'

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
    label: 'ВУЗ',
    path: '/app/univer',
    icon: <Building2 size={20} />,
  },
  {
    id: 'settings',
    label: 'Настройки',
    path: '/app/settings',
    icon: <Settings2 size={20} />,
  },
]

export const MainLayout = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const outlet = useOutlet()

  const activeTabId =
    TABS.find((tab) => location.pathname.startsWith(tab.path))?.id ??
    'planner'

  return (
    <div className="main-layout">
      <div className="main-layout-shell">
        <div className="main-layout-content">
          <div key={location.pathname} className="main-layout-panel">
            {outlet}
          </div>
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
                <span className="bottom-nav-icon">{tab.icon}</span>
                <span className="bottom-nav-label">{tab.label}</span>
              </button>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
