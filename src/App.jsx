import { useEffect, useState, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { FullPageSpinner } from './components/Spinner'

// 라우트 단위 코드 스플리팅 — 초기 번들 축소로 첫 화면 로딩(LCP) 개선
const Auth = lazy(() => import('./pages/Auth'))
const Onboarding = lazy(() => import('./pages/Onboarding'))
const RoleLanding = lazy(() => import('./pages/RoleLanding'))

const PlayerHome = lazy(() => import('./pages/player/Home'))
const Tournaments = lazy(() => import('./pages/player/Tournaments'))
const TournamentDetail = lazy(() => import('./pages/player/TournamentDetail'))
const MyMatches = lazy(() => import('./pages/player/MyMatches'))
const Profile = lazy(() => import('./pages/player/Profile'))
const Ranking = lazy(() => import('./pages/player/Ranking'))

const OrganizerDashboard = lazy(() => import('./pages/organizer/Dashboard'))
const CreateTournament = lazy(() => import('./pages/organizer/CreateTournament'))
const TournamentManage = lazy(() => import('./pages/organizer/TournamentManage'))
const EntryManagement = lazy(() => import('./pages/organizer/EntryManagement'))
const BracketGenerator = lazy(() => import('./pages/organizer/BracketGenerator'))
const LiveDashboard = lazy(() => import('./pages/organizer/LiveDashboard'))
const CourtView = lazy(() => import('./pages/organizer/CourtView'))

const LiveScore = lazy(() => import('./pages/public/LiveScore'))
const RefereeScoreboard = lazy(() => import('./pages/referee/Scoreboard'))
const Results = lazy(() => import('./pages/player/Results'))

// TEST_MODE=true 이면 로그인 없이 모든 페이지 접근 가능
const TEST_MODE = true

export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) loadProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session)
      if (session) loadProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(uid) {
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single()
    setProfile(data)
    setLoading(false)
  }

  if (!TEST_MODE && loading) return <FullPageSpinner />

  return (
    <BrowserRouter>
      <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        {/* 진입점: 역할 선택 랜딩 */}
        <Route path="/"  element={TEST_MODE ? <RoleLanding /> : (!session ? <Auth /> : <Navigate to="/home" replace />)} />
        <Route path="/auth" element={TEST_MODE ? <RoleLanding /> : (!session ? <Auth /> : <Navigate to="/home" replace />)} />
        <Route path="/onboarding" element={TEST_MODE ? <Navigate to="/" replace /> : (session ? <Onboarding /> : <Navigate to="/auth" replace />)} />

        <Route path="/home"            element={<Req s={session} p={profile}><PlayerHome /></Req>} />
        <Route path="/tournaments"     element={<Req s={session} p={profile}><Tournaments /></Req>} />
        <Route path="/tournaments/:id" element={<Req s={session} p={profile}><TournamentDetail /></Req>} />
        <Route path="/tournaments/:id/results" element={<Req s={session} p={profile}><Results /></Req>} />
        <Route path="/my-matches"      element={<Req s={session} p={profile}><MyMatches /></Req>} />
        <Route path="/ranking"         element={<Req s={session} p={profile}><Ranking /></Req>} />
        <Route path="/profile"         element={<Req s={session} p={profile}><Profile /></Req>} />

        <Route path="/organizer"             element={<Req s={session} p={profile}><OrganizerDashboard /></Req>} />
        <Route path="/organizer/create"      element={<Req s={session} p={profile}><CreateTournament /></Req>} />
        <Route path="/organizer/:id"         element={<Req s={session} p={profile}><TournamentManage /></Req>} />
        <Route path="/organizer/:id/entries" element={<Req s={session} p={profile}><EntryManagement /></Req>} />
        <Route path="/organizer/:id/bracket" element={<Req s={session} p={profile}><BracketGenerator /></Req>} />
        <Route path="/organizer/:id/live"    element={<Req s={session} p={profile}><LiveDashboard /></Req>} />
        <Route path="/organizer/:id/courts" element={<Req s={session} p={profile}><CourtView /></Req>} />

        <Route path="/live/:id" element={<LiveScore />} />
        <Route path="/referee/:matchId" element={<Req s={session} p={profile}><RefereeScoreboard /></Req>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

function Req({ s, p, children }) {
  if (TEST_MODE) return children
  if (!s) return <Navigate to="/" replace />
  if (p !== null && !p?.name) return <Navigate to="/onboarding" replace />
  return children
}
