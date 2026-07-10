// 사후 커뮤니케이션 캠페인 엔진 (C11) — 대회 생애주기 안내·공지 자동 발송
// ──────────────────────────────────────────────────────────────────────
// 목적: 주최자가 손으로 단톡방에 쓰던 "내일 대회예요 / 오늘 체크인하세요 /
//   참여 감사합니다 / 설문 부탁드려요" 를 앱이 상태·날짜만 보고 스스로 판정해
//   때가 되면 참가자에게 발송한다(무인 진행 ON 시 자동, OFF 시 원터치).
//
// 이 파일은 "언제·무슨 문구로 보낼지"만 계산하는 순수 로직이다. 실제 발송은
// notify.js 의 sendCampaign(3채널 팬아웃)이 담당하고, 실외부발송은 human-gated.
// 스키마 변경 없음 — 기존 tournaments(date/status/title/venue) 만 읽는다.
//
// 재발송 방지(idempotency)는 발신자 기기의 localStorage 로 처리한다
// (RLS 상 주최자는 수신자 알림을 조회할 수 없어 서버 조회로는 판정 불가).

import { CAMPAIGN } from './notify'

// 로컬 자정 기준 날짜 문자열(YYYY-MM-DD)
export function localDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 대회 날짜 - 오늘(둘 다 로컬 자정 기준)의 일수 차. 1=내일, 0=오늘, -1=어제.
// 파싱 불가한 날짜는 null.
export function dayDiff(dateStr, now = new Date()) {
  if (!dateStr) return null
  // 'YYYY-MM-DD' 또는 'YYYY-MM-DDT..' 앞 10자만 사용해 타임존 밀림을 피한다.
  const m = String(dateStr).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target - today) / 86400000)
}

// 장소 표기(테이블에 따라 venue 또는 location)
function placeOf(t) {
  return t?.venue || t?.location || null
}

// 대회 제목 안전 표기
function titleOf(t) {
  return t?.title || '대회'
}

// 각 캠페인의 제목·본문 문구 빌더
function copyFor(type, t) {
  const title = titleOf(t)
  const place = placeOf(t)
  const date = String(t?.date ?? '').slice(0, 10)
  const at = place ? `${place}에서 ` : ''
  switch (type) {
    case CAMPAIGN.REMIND_D1:
      return {
        label: '전날 안내',
        title: '📅 내일 대회가 열려요',
        body: `내일${date ? ` ${date}` : ''} '${title}' 대회가 ${at}열려요. 시간 맞춰 참석해주세요! 앱에서 내 경기 일정을 미리 확인할 수 있어요.`,
      }
    case CAMPAIGN.REMIND_DDAY:
      return {
        label: '당일 안내',
        title: '🏸 오늘 대회날이에요',
        body: `오늘 '${title}' 대회날이에요!${place ? ` ${place} 도착하면` : ''} 앱에서 바로 '셀프 체크인'하고 경기 호출을 기다려주세요.`,
      }
    case CAMPAIGN.THANKS:
      return {
        label: '감사 인사',
        title: '🙏 대회 참여 감사합니다',
        body: `'${title}' 대회에 함께해주셔서 감사합니다! 최종 순위·급수 반영·상장은 앱 '결과' 화면에서 확인하세요.`,
      }
    case CAMPAIGN.SURVEY:
      return {
        label: '만족도 설문',
        title: '📝 대회는 어떠셨나요?',
        body: `'${title}' 대회 경험을 짧게 남겨주시면 다음 대회가 더 좋아져요. 잠깐 시간 내주시면 큰 도움이 됩니다.`,
      }
    default:
      return { label: '안내', title: '대회 안내', body: '' }
  }
}

// ── 핵심: 지금 발송할 캠페인 판정 ──────────────────────────────────────
// tournament(상태·날짜) + now + 이미 보낸 type 집합(sent) → 발송 후보 목록.
//   반환 원소: { key, type, kind:'pre'|'post', label, title, body, sent }
//   sent=true 이면 이미 보낸 것(UI에서 '보냄' 표시). due 판정은 date/status 로만.
export function planCampaigns(tournament, { now = new Date(), sent = new Set() } = {}) {
  if (!tournament) return []
  const status = tournament.status
  const diff = dayDiff(tournament.date, now)
  const out = []
  const add = (type, kind) => {
    const c = copyFor(type, tournament)
    out.push({ key: type, type, kind, label: c.label, title: c.title, body: c.body, sent: sent.has(type) })
  }

  // 대회 전(접수중/마감) — 날짜가 확정된 경우에만
  if ((status === 'open' || status === 'closed') && diff === 1) add(CAMPAIGN.REMIND_D1, 'pre')
  // 대회 당일(마감/진행중)
  if ((status === 'closed' || status === 'in_progress') && diff === 0) add(CAMPAIGN.REMIND_DDAY, 'pre')
  // 종료 후 — 감사 → 설문 순
  if (status === 'completed') {
    add(CAMPAIGN.THANKS, 'post')
    add(CAMPAIGN.SURVEY, 'post')
  }
  return out
}

// 아직 안 보낸 것만 (자동 발송·미발송 배지용)
export function pendingCampaigns(tournament, opts) {
  return planCampaigns(tournament, opts).filter(c => !c.sent)
}

// ── 재발송 방지: 발신자 기기 localStorage ─────────────────────────────
function sentKey(tournamentId) {
  return `bdm.campaign.${tournamentId}`
}

// 이미 보낸 캠페인 type 집합 로드
export function loadSentCampaigns(tournamentId) {
  try {
    const raw = localStorage.getItem(sentKey(tournamentId))
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

// 보낸 캠페인 type 을 기록(중복 안전)
export function markCampaignSent(tournamentId, type) {
  try {
    const s = loadSentCampaigns(tournamentId)
    s.add(type)
    localStorage.setItem(sentKey(tournamentId), JSON.stringify([...s]))
    return s
  } catch {
    return loadSentCampaigns(tournamentId)
  }
}

// ── Supabase 헬퍼: 발송 대상(참가 확정 선수 프로필 id) 조회 ─────────────
// categoryIds 의 approved 엔트리에서 player1_id·player2_id 를 중복 없이 모은다.
export async function fetchCampaignRecipients(supabase, categoryIds) {
  const ids = [...new Set((categoryIds ?? []).filter(Boolean))]
  if (!ids.length) return []
  try {
    const { data, error } = await supabase
      .from('tournament_entries')
      .select('player1_id, player2_id')
      .in('category_id', ids)
      .eq('entry_status', 'approved')
    if (error) throw error
    const set = new Set()
    for (const row of data ?? []) {
      if (row.player1_id) set.add(row.player1_id)
      if (row.player2_id) set.add(row.player2_id)
    }
    return [...set]
  } catch {
    return []
  }
}
