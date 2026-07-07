import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { FullPageSpinner } from './components/Spinner'

import Auth from './pages/Auth'
import Onboarding from './pages/Onboarding'
import RoleLanding from './pages/RoleLanding'

import PlayerHome from './pages/player/Home'
import Tournaments from './pages/player/Tournaments'
import TournamentDetail from './pages/player/TournamentDetail'
import MyMatches from './pages/player/MyMatches'
import Profile from './pages/player/Profile'

import OrganizerDashboard from './pages/organizer/Dashboard'
import CreateTournament from './pages/organizer/CreateTournament'
import TournamentManage from './pages/organizer/TournamentManage'
import EntryManagement from './pages/organizer/EntryManagement'
import BracketGenerator from './pages/organizer/BracketGenerator'
import LiveDashboard from './pages/organizer/LiveDashboard'

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
      <Routes>
        {/* 진입점: 역할 선택 랜딩 */}
        <Route path="/"  element={TEST_MODE ? <RoleLanding /> : (!session ? <Auth /> : <Navigate to="/home" replace />)} />
        <Route path="/auth" element={TEST_MODE ? <RoleLanding /> : (!session ? <Auth /> : <Navigate to="/home" replace />)} />
        <Route path="/onboarding" element={TEST_MODE ? <Navigate to="/" replace /> : (session ? <Onboarding /> : <Navigate to="/auth" replace />)} />

        <Route path="/home"            element={<Req s={session} p={profile}><PlayerHome /></Req>} />
        <Route path="/tournaments"     element={<Req s={session} p={profile}><Tournaments /></Req>} />
        <Route path="/tournaments/:id" element={<Req s={session} p={profile}><TournamentDetail /></Req>} />
        <Route path="/my-matches"      element={<Req s={session} p={profile}><MyMatches /></Req>} />
        <Route path="/profile"         element={<Req s={session} p={profile}><Profile /></Req>} />

        <Route path="/organizer"             element={<Req s={session} p={profile}><OrganizerDashboard /></Req>} />
        <Route path="/organizer/create"      element={<Req s={session} p={profile}><CreateTournament /></Req>} />
        <Route path="/organizer/:id"         element={<Req s={session} p={profile}><TournamentManage /></Req>} />
        <Route path="/organizer/:id/entries" element={<Req s={session} p={profile}><EntryManagement /></Req>} />
        <Route path="/organizer/:id/bracket" element={<Req s={session} p={profile}><BracketGenerator /></Req>} />
        <Route path="/organizer/:id/live"    element={<Req s={session} p={profile}><LiveDashboard /></Req>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

function Req({ s, p, children }) {
  if (TEST_MODE) return children
  if (!s) return <Navigate to="/" replace />
  if (p !== null && !p?.name) return <Navigate to="/onboarding" replace />
  return children
}
