// ============================================================
// checkin.js — 셀프 체크인 엔진 (C4)
// 순수 판정 함수 + Supabase 헬퍼. 스키마 변경 없음
// (기존 tournament_checkins: verified_method 'verbal'|'id_card'|'auto'|'self',
//  flagged, flag_reason, UNIQUE(tournament_id, player_id) 사용).
//
// 북극성: 선수가 자기 폰으로 스스로 체크인 → 주최자는 예외(대리출전 의심)만 확인.
// ============================================================

// 로컬 기준 YYYY-MM-DD (대회 date 컬럼과 같은 형식)
export function localDateStr(now = Date.now()) {
  const d = new Date(now)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 대회 상태·날짜로 셀프 체크인 창을 판정한다.
// phase: 'before'(아직) | 'open'(체크인 가능) | 'ended'(종료/마감)
// canCheckin: 선수가 지금 셀프 체크인을 눌러도 되는가
export function getCheckinWindow(tournament, now = Date.now()) {
  if (!tournament) return { phase: 'before', canCheckin: false, label: '대회 정보 없음', sub: '' }

  const status = tournament.status
  // 종료된 대회는 체크인 불필요
  if (status === 'completed' || status === 'cancelled') {
    return { phase: 'ended', canCheckin: false, label: '대회 종료', sub: '체크인이 마감되었어요' }
  }
  // 이미 진행 중이면 언제든 체크인 가능 (지각 입장 포함)
  if (status === 'in_progress') {
    return { phase: 'open', canCheckin: true, label: '체크인 진행 중', sub: '지금 셀프 체크인하세요' }
  }

  const today = localDateStr(now)
  const date = tournament.date // 'YYYY-MM-DD'
  if (!date) {
    // 날짜 미정: 접수/대기 상태에선 아직 체크인 전
    return { phase: 'before', canCheckin: false, label: '체크인 준비 중', sub: '대회 당일 오전부터 셀프 체크인이 열려요' }
  }
  if (today < date) {
    return { phase: 'before', canCheckin: false, label: `${date} 예정`, sub: '대회 당일 오전부터 셀프 체크인이 열려요' }
  }
  if (today > date) {
    return { phase: 'ended', canCheckin: false, label: '대회일 경과', sub: '체크인 기간이 지났어요' }
  }
  // today === date → 당일
  return { phase: 'open', canCheckin: true, label: '오늘 대회 · 체크인 가능', sub: '도착하면 셀프 체크인하세요' }
}

// 셀프 체크인 시 본인확인이 필요한지 판정한다.
// 실명인증(identity_verified)된 선수는 무인 완료, 미인증은 현장 확인 권장(예외 큐).
export function assessSelfCheckin(profile) {
  if (!profile) return { needsReview: true, note: '프로필 정보를 불러오지 못했어요' }
  if (profile.identity_verified) {
    return { needsReview: false, note: '실명인증 완료 — 본인확인까지 자동으로 끝나요' }
  }
  return {
    needsReview: true,
    note: '실명인증 전이라 셀프 체크인 후 현장에서 본인확인이 한 번 필요할 수 있어요',
  }
}

// ── Supabase 헬퍼 ──────────────────────────────────────────────

// 선수 셀프 체크인 (upsert). verified_method='self'.
// 미인증 선수는 flagged로 남기지 않고, 주최자 화면에서 method+인증여부로 예외 판단.
export async function selfCheckin(supabase, { tournamentId, playerId, checkedInBy = null }) {
  return supabase.from('tournament_checkins').upsert({
    tournament_id: tournamentId,
    player_id: playerId,
    checked_in_by: checkedInBy ?? playerId, // 셀프: 본인이 확인 주체
    verified_method: 'self',
    checked_in_at: new Date().toISOString(),
    flagged: false,
  }, { onConflict: 'tournament_id,player_id' })
}

// 특정 대회에서 이 선수의 체크인 행 조회 (없으면 null).
// 013/005 미적용 등으로 테이블이 없어도 크래시하지 않도록 degrade.
export async function fetchMyCheckin(supabase, tournamentId, playerId) {
  try {
    const { data, error } = await supabase
      .from('tournament_checkins')
      .select('*')
      .eq('tournament_id', tournamentId)
      .eq('player_id', playerId)
      .maybeSingle()
    if (error) return null
    return data ?? null
  } catch {
    return null
  }
}

// 여러 대회에 대한 내 체크인 상태를 한 번에 조회 → { [tournamentId]: row }
export async function fetchMyCheckins(supabase, tournamentIds, playerId) {
  const ids = [...new Set((tournamentIds ?? []).filter(Boolean))]
  if (!ids.length || !playerId) return {}
  try {
    const { data, error } = await supabase
      .from('tournament_checkins')
      .select('*')
      .in('tournament_id', ids)
      .eq('player_id', playerId)
    if (error || !data) return {}
    const map = {}
    for (const row of data) map[row.tournament_id] = row
    return map
  } catch {
    return {}
  }
}

// 노쇼(호출 미응답) 자동 부전승 판정 (C7) — 체크인 데이터로 "누가 안 왔는지"를 확신할 수 있는가.
// ──────────────────────────────────────────────────────────────────────
// 지금껏 호출 후 유예가 지난(overdue) 경기는 사람이 "어느 팀이 안 왔는지"를 1탭으로
// 골라야만 부전승 처리됐다("누가 안 왔는지"는 현장 판단이라 남겨둠). 하지만 셀프
// 체크인(C4)으로 앱은 이미 "누가 대회장에 왔는지"를 안다. 한 팀은 전원 체크인(현장에
// 있음)인데 상대 팀은 전원 미체크인(오지 않음)이면 누가 부전승인지 확신할 수 있으므로
// 무인 확정한다. 애매한 경우 — 둘 다 체크인(대회장엔 왔는데 코트만 안 옴) / 둘 다
// 미체크인(더블 노쇼, 어느 팀을 진출시킬지 불명) / 체크인 현황 불충분 — 은
// resolvable=false 로 두고 사람이 최종 판단한다(near-zero touch, 예외만 사람).
//
//   match     : { team1:{player1,player2}, team2:{player1,player2} } (LiveDashboard 조인 형태)
//   checkedIn : Set<player_id> 또는 배열 — 이 대회에 체크인한 선수 id
// 반환 { resolvable, absentTeam(1|2|null), winnerTeam(1|2|null), t1, t2, reason }
//   t1/t2 : { total, checkedCount, present, absent } 팀별 체크인 현황(UI 힌트용)
export function assessNoShowResolution(match, checkedIn) {
  const set = checkedIn instanceof Set ? checkedIn : new Set(checkedIn ?? [])
  const idsOf = team => [team?.player1?.id, team?.player2?.id].filter(Boolean)
  const statusOf = team => {
    const ids = idsOf(team)
    const checkedCount = ids.filter(pid => set.has(pid)).length
    return {
      total: ids.length,
      checkedCount,
      present: ids.length > 0 && checkedCount === ids.length, // 전원 체크인 = 현장에 있음
      absent: ids.length > 0 && checkedCount === 0,           // 전원 미체크인 = 오지 않음
    }
  }
  const t1 = statusOf(match?.team1)
  const t2 = statusOf(match?.team2)

  let resolvable = false, absentTeam = null, winnerTeam = null, reason = ''
  if (t1.absent && t2.present) {
    resolvable = true; absentTeam = 1; winnerTeam = 2
    reason = '팀1 전원 미체크인 · 팀2 체크인 완료'
  } else if (t2.absent && t1.present) {
    resolvable = true; absentTeam = 2; winnerTeam = 1
    reason = '팀2 전원 미체크인 · 팀1 체크인 완료'
  } else if (t1.absent && t2.absent) {
    reason = '양 팀 모두 미체크인 — 더블 노쇼(사람 확인)'
  } else if (t1.present && t2.present) {
    reason = '양 팀 모두 체크인 완료 — 코트 미입장(사람 확인)'
  } else {
    reason = '체크인 현황이 불충분 — 사람 확인'
  }
  return { resolvable, absentTeam, winnerTeam, t1, t2, reason }
}

// ── 셀프 체크인 키오스크 (C4) ─────────────────────────────────────────
// 입구에 공용 태블릿 한 대를 두고 선수가 직접 자기 이름을 찾아 체크인하는 "키오스크"
// 모드용 순수 헬퍼. 주최자가 명단을 한 명씩 눌러 주던 수작업을 선수 셀프로 넘긴다
// (RLS 는 005 에서 전체 허용이므로 새 권한 불필요, verified_method='self' 로 기록).

// 이름 정규화 — 공백 제거 + 소문자. 키오스크 검색에서 "김민수"·"김 민수" 동일 취급.
export function normalizeKioskName(s) {
  return String(s ?? '').toLowerCase().replace(/\s+/g, '').trim()
}

// 승인된 참가 신청 + 체크인 행 → 키오스크 명단(선수 단위로 중복 제거).
// entries: [{ id, categoryName?, category?, player1:{id,name,identity_verified}, player2 }]
// checkins: [{ player_id, checked_in_at, flagged, verified_method }]
// 반환: [{ playerId, name, verified, checkedIn, checkedInAt, method, entries:[{category, partner}] }]
//   정렬: 미체크인 먼저(줄 서 있는 사람이 위로) → 이름 오름차순.
export function buildKioskRoster(entries, checkins) {
  const chkById = new Map()
  for (const c of checkins ?? []) {
    if (c && c.player_id != null) chkById.set(c.player_id, c)
  }
  const labelOf = e =>
    e?.categoryName || e?.category?.sport_type || e?.category?.name || ''

  const byPlayer = new Map()
  for (const e of entries ?? []) {
    const pair = [e?.player1, e?.player2].filter(p => p && p.id != null)
    for (const p of pair) {
      const partner = pair.find(o => o.id !== p.id)
      let row = byPlayer.get(p.id)
      if (!row) {
        row = {
          playerId: p.id,
          name: p.name || '이름 미상',
          verified: !!p.identity_verified,
          entries: [],
        }
        byPlayer.set(p.id, row)
      }
      row.entries.push({ category: labelOf(e), partner: partner?.name || null })
    }
  }

  const roster = [...byPlayer.values()].map(row => {
    const chk = chkById.get(row.playerId)
    const checkedIn = !!chk && !chk.flagged
    return {
      ...row,
      checkedIn,
      checkedInAt: checkedIn ? (chk.checked_in_at ?? null) : null,
      method: chk?.verified_method ?? null,
    }
  })

  roster.sort((a, b) => {
    if (a.checkedIn !== b.checkedIn) return a.checkedIn ? 1 : -1
    return a.name.localeCompare(b.name, 'ko')
  })
  return roster
}

// 키오스크 검색 — 이름에 질의(정규화)가 포함된 선수만. 빈 질의는 전체.
export function filterKioskRoster(roster, query) {
  const q = normalizeKioskName(query)
  if (!q) return roster ?? []
  return (roster ?? []).filter(r => normalizeKioskName(r.name).includes(q))
}

// 키오스크 상단 진행 통계.
export function kioskStats(roster) {
  const total = (roster ?? []).length
  const done = (roster ?? []).filter(r => r.checkedIn).length
  return { total, done, remaining: total - done }
}

// 체크인 요약 통계 (주최자 화면용). players: [{id, identity_verified}], checkins: rows
export function summarizeCheckins(players, checkins) {
  const byId = new Map((checkins ?? []).map(c => [c.player_id, c]))
  let done = 0, self = 0, flagged = 0, reviewNeeded = 0
  for (const p of players ?? []) {
    const c = byId.get(p.id)
    if (!c) continue
    if (c.flagged) { flagged++; continue }
    done++
    if (c.verified_method === 'self') {
      self++
      if (!p.identity_verified) reviewNeeded++ // 셀프 + 미인증 → 현장 확인 권장
    }
  }
  return { total: (players ?? []).length, done, self, flagged, reviewNeeded }
}
