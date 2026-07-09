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
