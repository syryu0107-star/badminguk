import { NavLink } from 'react-router-dom'
import { Home, Trophy, Medal, CalendarDays, User, LayoutDashboard, PlusCircle, GitBranch, Zap } from 'lucide-react'

const playerNav = [
  { to: '/home',        icon: Home,        label: '홈' },
  { to: '/tournaments', icon: Trophy,       label: '대회' },
  { to: '/ranking',     icon: Medal,        label: '랭킹' },
  { to: '/my-matches',  icon: CalendarDays, label: '내 신청' },
  { to: '/profile',     icon: User,         label: '프로필' },
]

const organizerNav = [
  { to: '/organizer',        icon: LayoutDashboard, label: '대시보드' },
  { to: '/organizer/create', icon: PlusCircle,      label: '대회 만들기' },
]

export default function BottomNav({ mode = 'player' }) {
  const items = mode === 'organizer' ? organizerNav : playerNav

  return (
    <nav
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-50
                 bg-white border-t border-gray-200"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex">
        {items.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors
               ${isActive ? 'text-[#C60C30]' : 'text-gray-400'}`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
