// chatbot.js — C9 문의 챗봇 (규정 FAQ + 대진/일정 개인화 응답)
// ──────────────────────────────────────────────────────────────────────
// 목적: 대회 단톡방에서 주최자가 손으로 답하던 "언제 시작해요? 어디서 해요?
//       참가비 얼마예요? 제 신청 됐어요? 점수 규칙이 뭐예요?"를 앱이 스스로
//       답한다. 사람 문의 응대(운영자 수작업)를 없애는 것이 목표.
//
// 이 파일은 순수 함수만 담는다 — 외부 LLM/키가 필요 없다. 정적 규정
// 지식베이스(RAG용 문서) + 대회 데이터(ctx)에 기반한 검색·응답 엔진이다.
// 실제 LLM 연동은 미래 옵션(human-gated)이고, 지금은 규칙 기반으로 완결 동작한다.
//
// ctx 형태(모두 선택):
//   {
//     tournament : { title, venue, venue_address, date, start_time,
//                    registration_end, status, description, unit },
//     categories : [{ sport_type, entry_fee, prize_description, max_teams,
//                     allowed_grades, grade_min, grade_max, min_mmr, max_mmr }],
//     myEntries  : [{ category_id, entry_status, payment_status }],
//   }

import { computeRefund, refundLineText, policyLines } from './refund'
import { bankTransferInfo } from './deposit'

// ─── 포맷 헬퍼 ────────────────────────────────────────────────────────

const WD = ['일', '월', '화', '수', '목', '금', '토']

export function fmtDate(d) {
  if (!d) return null
  const dt = new Date(`${String(d).slice(0, 10)}T00:00:00`)
  if (isNaN(dt.getTime())) return String(d)
  return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일(${WD[dt.getDay()]})`
}

export function fmtDateTime(v) {
  if (!v) return null
  const dt = new Date(v)
  if (isNaN(dt.getTime())) return String(v)
  const ymd = `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일(${WD[dt.getDay()]})`
  const h = dt.getHours(), m = dt.getMinutes()
  const ap = h < 12 ? '오전' : '오후'
  const hh = h % 12 === 0 ? 12 : h % 12
  return `${ymd} ${ap} ${hh}시${m ? ` ${m}분` : ''}`
}

export function fmtTime(t) {
  if (!t) return null
  const [h, m] = String(t).split(':').map(Number)
  if (!Number.isFinite(h)) return String(t)
  const ap = h < 12 ? '오전' : '오후'
  const hh = h % 12 === 0 ? 12 : h % 12
  return m ? `${ap} ${hh}시 ${m}분` : `${ap} ${hh}시`
}

export function fmtWon(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v === 0) return '무료'
  return v.toLocaleString('ko-KR') + '원'
}

// ─── 상태 라벨 ────────────────────────────────────────────────────────

const ENTRY_LABEL = {
  applied:         '심사 중 (주최자 승인 대기)',
  approved:        '참가 확정 ✅',
  rejected:        '거절됨',
  withdrawn:       '철회함',
  waitlisted:      '대기 명단',
  partner_pending: '파트너 수락 대기',
  partner_rejected:'파트너가 거절함',
}
const PAY_LABEL = {
  pending:   '입금 대기',
  confirmed: '입금 확인됨',
  refunded:  '환불됨',
}

// 종목별 자격 문구(급수/ MMR 게이트)를 한 줄로
function eligLine(cat) {
  const parts = []
  if (Array.isArray(cat?.allowed_grades) && cat.allowed_grades.length) {
    parts.push(`${cat.allowed_grades.join('·')} 참가 가능`)
  } else if (cat?.grade_min || cat?.grade_max) {
    if (cat.grade_min && cat.grade_max) parts.push(`${cat.grade_min}~${cat.grade_max}`)
    else if (cat.grade_min) parts.push(`${cat.grade_min} 이상`)
    else parts.push(`${cat.grade_max} 이하`)
  }
  if (cat?.min_mmr) parts.push(`MMR ${cat.min_mmr} 이상`)
  if (cat?.max_mmr) parts.push(`MMR ${cat.max_mmr} 이하`)
  return parts.length ? parts.join(' · ') : '급수 제한 없음'
}

// ─── 정규화 · 매칭 ────────────────────────────────────────────────────

// 한글은 띄어쓰기가 들쭉날쭉하므로 공백·문장부호를 지우고 부분일치로 본다.
export function normalize(s) {
  return String(s ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

// ─── 지식베이스(주제) ────────────────────────────────────────────────
// personal=true 는 대회 데이터(ctx)에 기반한 개인화 응답, 그 외는 규정 FAQ.
// answer(ctx) 는 항상 문자열을 반환한다(데이터가 없으면 일반 안내로 폴백).

const TOPICS = [
  {
    id: 'schedule', personal: true,
    keywords: ['언제시작', '몇시', '시작시간', '시작해', '시작하나', '경기시간', '언제해', '언제열려', '타임테이블', '스케줄', '일정'],
    answer: (ctx) => {
      const t = ctx.tournament
      const d = fmtDate(t?.date), st = fmtTime(t?.start_time)
      if (!d) return '대회 일정은 대회 상세 화면 상단에서 확인할 수 있어요.'
      let s = `대회는 ${d}${st ? ` ${st}` : ''}에 시작해요.`
      s += ' 내 경기의 정확한 코트·예상 호출 시각은 대진표가 나오고 대회가 시작되면 "내 신청" 화면에서 실시간으로 안내돼요.'
      return s
    },
  },
  {
    id: 'location', personal: true,
    keywords: ['어디서', '어디에서', '어디예', '어디인', '장소', '위치', '주소', '오는길', '가는길', '어느체육관', '경기장'],
    answer: (ctx) => {
      const t = ctx.tournament
      if (!t?.venue) return '대회 장소는 대회 상세 화면 상단에서 확인할 수 있어요.'
      return `대회 장소는 "${t.venue}"예요.${t.venue_address ? ` 주소는 ${t.venue_address}입니다.` : ''}`
    },
  },
  {
    id: 'fee', personal: true,
    keywords: ['참가비', '참가비용', '얼마예', '얼마인', '비용', '가격', '등록비', '참가비얼마', '돈얼마'],
    answer: (ctx) => {
      const cats = ctx.categories ?? []
      if (!cats.length) return '참가비는 종목마다 다를 수 있어요. 대회 상세 화면의 종목별 금액을 확인해 주세요.'
      const fees = cats.map(c => `${c.sport_type} ${fmtWon(c.entry_fee)}`)
      const allSame = cats.every(c => Number(c.entry_fee) === Number(cats[0].entry_fee))
      let s = allSame
        ? `참가비는 ${fmtWon(cats[0].entry_fee)}예요.`
        : `종목별 참가비예요 — ${fees.join(' · ')}.`
      if (cats.some(c => Number(c.entry_fee) > 0)) {
        s += ' 참가비가 있는 종목은 무통장 입금 후 입금자명이 확인되면 자동으로 참가 확정돼요.'
      }
      return s
    },
  },
  {
    id: 'deadline', personal: true,
    keywords: ['접수마감', '신청마감', '언제까지', '접수기간', '신청기간', '마감언제', '언제마감', '접수언제', '마감일'],
    answer: (ctx) => {
      const t = ctx.tournament
      const end = fmtDateTime(t?.registration_end)
      if (t?.status && t.status !== 'open') {
        return '접수가 이미 마감된 대회예요. 다음 대회를 이용해 주세요.'
      }
      if (!end) return '접수 마감 시각은 대회 상세 화면에서 확인할 수 있어요. 정원이 다 차면 조기 마감될 수 있어요.'
      return `접수 마감은 ${end}이에요. 마감 시각이 지나거나 모든 종목 정원이 차면 자동으로 접수가 닫혀요.`
    },
  },
  {
    id: 'my_status', personal: true,
    keywords: ['내신청', '신청됐', '신청됬', '신청확인', '내상태', '신청상태', '승인됐', '승인됬', '참가확정', '나승인', '내가신청'],
    answer: (ctx) => {
      const cats = ctx.categories ?? []
      const byId = Object.fromEntries(cats.map(c => [c.id, c]))
      const mine = (ctx.myEntries ?? []).filter(e => e.entry_status !== 'withdrawn')
      if (!mine.length) return '아직 신청한 종목이 없어요. 대회 상세 화면에서 참가 종목을 선택해 신청할 수 있어요.'
      const lines = mine.map(e => {
        const sport = byId[e.category_id]?.sport_type ?? '종목'
        const st = ENTRY_LABEL[e.entry_status] ?? e.entry_status
        const fee = Number(byId[e.category_id]?.entry_fee) || 0
        const pay = fee > 0 ? ` · 결제: ${PAY_LABEL[e.payment_status] ?? '입금 대기'}` : ''
        return `• ${sport}: ${st}${pay}`
      })
      return `내 신청 상태예요.\n${lines.join('\n')}`
    },
  },
  {
    id: 'payment', personal: true,
    keywords: ['입금', '계좌', '무통장', '송금', '입금확인', '결제방법', '어떻게내', '돈내', '입금언제', '카드결제', '계좌번호', '어디로'],
    answer: (ctx) => {
      const bank = bankTransferInfo(ctx.tournament ?? {})
      const head = bank
        ? `참가비는 아래 계좌로 무통장 입금하면 돼요.\n💳 ${bank.line}${bank.bankHolder ? ` (예금주 ${bank.bankHolder})` : ''}`
        : '참가비는 주최자가 안내한 계좌로 무통장 입금하면 돼요.'
      return `${head}\n입금자명을 신청자 본인(또는 파트너) 실명으로 넣으면 앱이 자동으로 대조해 "입금 확인"으로 바꿔주고, 참가 확정도 자동으로 이어져요. 카드·간편결제는 아직 준비 중이에요.`
    },
  },
  {
    id: 'checkin', personal: false,
    keywords: ['체크인', '출석', '접수처', '현장확인', '도착하면', '가서뭐', '입장확인'],
    answer: () =>
      '대회 당일(또는 대회 진행 중)에 "내 신청" 화면의 "체크인 · 디지털 선수증" 카드에서 버튼 한 번으로 셀프 체크인할 수 있어요. 실명인증을 마친 선수는 바로 완료되고, 미인증이면 현장에서 본인 확인만 하면 돼요.',
  },
  {
    id: 'format', personal: false,
    keywords: ['경기방식', '대진방식', '방식이', '포맷', '조별리그', '리그전', '토너먼트', '어떻게진행', '몇게임', '몇점제', '진행방식'],
    answer: () =>
      '대회는 종목마다 방식이 달라요.\n• 리그전: 참가팀 모두와 한 번씩 경기해요.\n• 토너먼트: 지면 탈락해요.\n• 조별리그+본선: 조에서 좋은 성적을 내면 본선 토너먼트에 올라가요.\n각 경기는 보통 3게임 2선승·21점 랠리포인트예요. 내 종목의 정확한 방식은 대진표에서 확인할 수 있어요.',
  },
  {
    id: 'eligibility', personal: true,
    keywords: ['참가자격', '참가가능', '자격', '아무나', '급수제한', '나참가', '참가돼', '참가할수', '누가참가', '제한있'],
    answer: (ctx) => {
      const cats = ctx.categories ?? []
      if (!cats.length) return '참가 자격은 종목마다 달라요. 대회 상세 화면의 종목별 급수·MMR 조건을 확인해 주세요.'
      const lines = cats.map(c => `• ${c.sport_type}: ${eligLine(c)}`)
      return `종목별 참가 자격이에요.\n${lines.join('\n')}\n조건에 맞지 않는 종목은 신청 버튼이 잠겨요.`
    },
  },
  {
    id: 'prize', personal: true,
    keywords: ['상금', '상품', '시상', '우승상금', '트로피', '메달', '상장', '입상하면', '몇위까지'],
    answer: (ctx) => {
      const cats = (ctx.categories ?? []).filter(c => c.prize_description)
      const base = '입상하면 순위가 확정된 뒤 디지털 상장이 자동 발급돼 "내 결과" 화면에서 인쇄(PDF 저장)할 수 있어요.'
      if (!cats.length) return `시상 내역은 종목별로 달라요. 대회 상세 화면의 상품 안내를 확인해 주세요. ${base}`
      const lines = cats.map(c => `• ${c.sport_type}: ${c.prize_description}`)
      return `종목별 시상 내역이에요.\n${lines.join('\n')}\n${base}`
    },
  },
  {
    id: 'refund', personal: true,
    keywords: ['환불', '취소하고', '신청취소', '철회', '돈돌려', '환불돼', '못가게', '환불규정'],
    answer: (ctx) => {
      const t = ctx.tournament ?? {}
      const catById = Object.fromEntries((ctx.categories ?? []).map(c => [c.id, c]))
      // 접수 마감 전이면 "지금 취소하면 얼마 환불"의 기준이 마감 datetime 이 된다.
      const opt = { tournamentDate: t.date, registrationEnd: t.registration_end }

      const lines = ['참가 철회·환불 규정 안내예요.', '', '📋 환불 규정(취소 시점 기준)']
      lines.push(...policyLines())

      // 개인화: 입금 확인된 내 신청이 있으면 "지금 취소하면 얼마"를 규정으로 계산.
      const paid = (ctx.myEntries ?? []).filter(e => e.payment_status === 'confirmed')
      const priced = paid
        .map(e => ({ e, cat: catById[e.category_id] }))
        .filter(x => x.cat && Number(x.cat.entry_fee) > 0)
      if (priced.length) {
        lines.push('', '💰 지금 취소하면(내 입금 기준)')
        for (const { e, cat } of priced) {
          const r = computeRefund({
            fee: Number(cat.entry_fee), paymentStatus: 'confirmed', ...opt,
          })
          const sport = cat.sport_type ? `${cat.sport_type}: ` : ''
          if (r.requiresReview) {
            lines.push(`• ${sport}${r.reason}`)
          } else {
            lines.push(`• ${sport}${refundLineText(r)}`)
          }
        }
        lines.push('', '취소는 "내 신청" 화면에서 할 수 있어요. 환불금 송금은 주최자가 규정 금액대로 처리해요.')
      } else {
        lines.push('', '취소는 "내 신청" 화면에서 할 수 있어요. 입금한 참가비가 있으면 위 규정에 따라 환불돼요.')
      }
      lines.push('※ 대회 당일·이후(노쇼·지각·응급)는 주최자가 확인하는 예외예요.')
      return lines.join('\n')
    },
  },
  {
    id: 'scoring', personal: false,
    keywords: ['점수규칙', '스코어', '듀스', '21점', '몇점내야', '득점', '랠리포인트', '골든포인트', '점수어떻게', '규칙알려'],
    answer: () =>
      '점수는 BWF 공식 규칙을 따라요.\n• 한 게임은 21점 랠리포인트제(서브권과 무관하게 이긴 쪽이 득점).\n• 20-20이면 듀스 — 2점 차가 날 때까지 이어지고, 29-29가 되면 30점째(골든포인트)를 먼저 낸 쪽이 이겨요.\n• 보통 3게임 2선승제예요.',
  },
  {
    id: 'bye', personal: false,
    keywords: ['부전승', '부전', 'bye', '대진운', '한명없', '자동진출'],
    answer: () =>
      '부전승(부전)은 대진표에서 상대가 없어 경기 없이 다음 라운드로 자동 진출하는 거예요. 참가팀 수가 딱 떨어지지 않을 때 생기고, 공개 추첨으로 배정돼 누구나 씨드 코드로 검증할 수 있어요.',
  },
  {
    id: 'noshow', personal: false,
    keywords: ['노쇼', '불참', '안오면', '미참석', '지각하면', '늦으면', '호출안'],
    answer: () =>
      '경기 호출 후 정해진 시간 안에 코트에 입장하지 않으면 먼저 긴급 경고 알림이 가고, 그래도 오지 않으면 부전승(상대 자동 승리)으로 처리될 수 있어요. 호출 알림은 "내 신청" 화면에 실시간으로 떠요.',
  },
  {
    id: 'mmr', personal: false,
    keywords: ['mmr', '엠엠알', '레이팅', '실력점수', '점수제도', '급수랑mmr', 'mmr뭐'],
    answer: () =>
      'MMR은 경기 결과로 자동 계산되는 실력 점수예요. 대회에서 이기면 오르고 지면 내려가며, 경기를 많이·최근에·검증된 대회에서 할수록 "신뢰도"가 올라가 전국 랭킹에 정식 등재돼요. 신고 급수와 실제 MMR 차이가 크면 샌드배깅(급수 사기)으로 자동 표시돼요.',
  },
  {
    id: 'sandbag', personal: false,
    keywords: ['샌드배깅', '급수사기', '다운급수', '급수낮춰', '실력숨겨'],
    answer: () =>
      '샌드배깅은 실제 실력보다 낮은 급수로 신고해 하위 종목에서 유리하게 겨루는 행위예요. 배드민국은 신고 급수와 실측 MMR·과거 입상 이력을 자동 대조해 의심 신청을 주최자 심사 화면에 표시하고, 확인되면 승인이 거절될 수 있어요.',
  },
  {
    id: 'partner', personal: false,
    keywords: ['파트너', '복식파트너', '짝', '같이나가', '팀원', '파트너어떻게', '파트너찾', '혼자'],
    answer: () =>
      '복식 종목은 파트너가 필요해요. 신청 화면에서 파트너를 전화번호나 이름으로 검색해 지정하면 초대가 가고, 파트너가 수락하면 신청이 완료돼요. 파트너도 배드민국에 가입돼 있어야 하고, 파트너에게도 같은 급수·MMR 자격 조건이 적용돼요. 단식 종목은 혼자 신청해요.',
  },
  {
    id: 'apply', personal: false,
    keywords: ['신청방법', '어떻게신청', '참가신청', '접수방법', '신청어떻게', '어떻게참가', '신청하려'],
    answer: () =>
      '참가 신청은 이렇게 해요.\n1) 대회 상세 화면에서 참가할 종목을 선택해요.\n2) 복식이면 파트너를 검색해 지정해요(단식은 바로).\n3) "참가 신청"을 누르면 접수돼요.\n4) 참가비가 있으면 안내 계좌로 입금하면 자동 확인·확정돼요.\n진행 상황은 "내 신청" 화면에서 확인할 수 있어요.',
  },
]

// ─── 응답 생성 ────────────────────────────────────────────────────────

export function matchTopic(query) {
  const q = normalize(query)
  if (!q) return null
  let best = null
  for (const t of TOPICS) {
    let score = 0, hits = 0
    for (const kw of t.keywords) {
      const k = normalize(kw)
      if (k && q.includes(k)) { score += k.length; hits++ }
    }
    if (score > 0 && (!best || score > best.score)) best = { topic: t, score, hits }
  }
  return best
}

function fallbackAnswer() {
  return '그 질문은 제가 아직 정확히 답하기 어려워요. 아래 자주 묻는 질문을 눌러보거나, 대회 주최자에게 직접 문의해 주세요.'
}

/**
 * 질문 문자열 + 대회 데이터로 답변을 만든다.
 * @returns {{ kind:'personal'|'faq'|'fallback', topic:string|null, answer:string }}
 */
export function askBot(query, ctx = {}) {
  const m = matchTopic(query)
  if (!m) return { kind: 'fallback', topic: null, answer: fallbackAnswer() }
  return {
    kind: m.topic.personal ? 'personal' : 'faq',
    topic: m.topic.id,
    answer: m.topic.answer(ctx ?? {}),
  }
}

// 대회 데이터로 노출할 만한 추천 질문(있는 정보만) — 칩으로 표시
export function suggestedQuestions(ctx = {}) {
  const t = ctx.tournament ?? {}
  const cats = ctx.categories ?? []
  const hasFee = cats.some(c => Number(c.entry_fee) > 0)
  const list = []
  if (t.date) list.push('대회 언제 시작해요?')
  if (t.venue) list.push('장소가 어디예요?')
  list.push(hasFee ? '참가비 얼마예요?' : '참가 자격이 어떻게 돼요?')
  if (t.status === 'open') list.push('접수 언제 마감돼요?')
  if ((ctx.myEntries ?? []).length) list.push('내 신청 상태 확인')
  list.push('경기 방식이 뭐예요?')
  list.push('점수 규칙 알려줘')
  list.push('노쇼하면 어떻게 돼요?')
  // 중복 제거 + 최대 6개
  return [...new Set(list)].slice(0, 6)
}

// 참고용 전체 주제 id 목록(테스트/디버그)
export const TOPIC_IDS = TOPICS.map(t => t.id)
