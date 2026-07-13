// 선수 입금 안내 (무통장 입금) — 참가비 결제 단계 완주 보조
// -----------------------------------------------------------------------------
// 북극성 체인의 "입금" 단계에서, 참가비가 있는 신청을 한 선수에게
//  (1) 얼마를,
//  (2) 어떤 입금자명으로 넣어야 앱이 자동으로 확인하는지,
//  (3) 지금 상태가 어디쯤인지
// 를 화면 하나로 알려 주기 위한 순수 로직.
//
// 핵심: 주최자의 무통장 입금 자동 매칭(C3 payment.js `matchDeposits`)은 입금자명을
// 신청 팀의 player1 OR player2 실명과 유사도로 대조한다. 따라서 "본인(또는 파트너)
// 실명으로 입금"만 지키면 사람 손 없이 입금이 confirmed 로 바뀌고, 그대로 무인 승인
// (planAutoApprovals 의 payment 버킷 비움)까지 이어진다. 이 안내가 그 전제를 선수에게
// 처음으로 명시적으로 전달한다.
//
// 스키마·외부 키 불필요. PG(카드)·가상계좌는 human-gated 로 남는다.

/** ₩ 천단위 콤마 (음수 안전) */
export function formatWon(n) {
  const v = Math.round(Number(n) || 0)
  return (v < 0 ? '-₩' : '₩') + Math.abs(v).toLocaleString('ko-KR')
}

/**
 * 이 신청이 "입금 안내" 단계에 있는지 (파트너 수락 전·거절·철회 등은 제외).
 * @param {object} entry tournament_entries row (entry_status, payment_status)
 * @param {number} fee   해당 종목 참가비
 */
export function shouldShowDeposit(entry, fee) {
  if (!entry) return false
  if (!(Number(fee) > 0 || Number(entry.payment_amount) > 0)) return false // 무료
  const st = entry.entry_status
  // 파트너 수락 대기/거절, 반려/철회/취소는 입금 단계 아님
  if (['partner_pending', 'partner_rejected', 'rejected', 'withdrawn', 'cancelled'].includes(st)) {
    return false
  }
  return true
}

/**
 * 무통장 입금 계좌 정보 정규화 (순수). 컬럼 미적용/미입력 시 null.
 * @param {object} bank { bankName, bankAccount, bankHolder } — 대회 계좌 필드
 * @returns {object|null} { bankName, bankAccount, bankHolder, line } 또는 null
 */
export function bankTransferInfo(bank = {}) {
  const bankName = (bank.bankName ?? bank.bank_name ?? '').toString().trim()
  const bankAccount = (bank.bankAccount ?? bank.bank_account ?? '').toString().trim()
  const bankHolder = (bank.bankHolder ?? bank.bank_holder ?? '').toString().trim()
  if (!bankAccount) return null // 계좌번호가 없으면 안내할 수 없음
  const line = [bankName, bankAccount].filter(Boolean).join(' ')
  return { bankName, bankAccount, bankHolder, line }
}

/**
 * 선수 화면용 입금 안내 데이터 생성 (순수).
 * @param {object} entry  tournament_entries row (payment_status, payment_amount)
 * @param {object} opts   { fee, myName, partnerName, bank:{bankName,bankAccount,bankHolder} }
 * @returns {object} { applicable, done, tone, title, amount, status, steps[], note, payerName, bank }
 */
export function depositGuide(entry, opts = {}) {
  if (!entry) return { applicable: false }
  const fee = Number(opts.fee) || 0
  const paid = Number(entry.payment_amount) || 0
  const amount = paid > 0 ? paid : fee
  if (amount <= 0) return { applicable: false, reason: 'free' }

  const status = entry.payment_status || 'pending'
  const myName = (opts.myName || '').trim()
  const partnerName = (opts.partnerName || '').trim()

  if (status === 'confirmed') {
    return {
      applicable: true, done: true, status, amount,
      tone: 'done', title: '입금 완료',
      message: '참가비 입금이 자동으로 확인됐어요. 참가 승인을 기다려 주세요.',
    }
  }
  if (status === 'refunded') {
    return {
      applicable: true, done: true, status, amount,
      tone: 'muted', title: '환불 완료',
      message: '참가비가 환불 처리됐어요.',
    }
  }

  // pending — 입금 대기
  const bank = bankTransferInfo(opts.bank ?? {})
  const nameLine = myName
    ? `입금자명을 반드시 "${myName}" (본인 실명)으로 넣어 주세요.`
    : '입금자명을 신청한 본인 실명으로 넣어 주세요.'
  const steps = [
    bank
      ? `참가비 ${formatWon(amount)}을(를) 아래 계좌로 입금해요.`
      : `참가비 ${formatWon(amount)}을(를) 주최자가 안내한 계좌로 입금해요.`,
    `${nameLine} 앱이 입금자명을 보고 자동으로 확인해요.`,
    '입금이 확인되면 이 카드가 "입금 완료"로 바뀌어요 (보통 몇 분 내).',
  ]
  // 계좌가 앱에 있으면 "문의로 물어보라"는 안내는 불필요.
  const note = partnerName
    ? `본인(${myName || '신청자'}) 또는 파트너(${partnerName}) 실명 중 하나로 입금하면 자동 확인돼요.`
    : (bank
        ? '입금자명(실명)만 맞으면 앱이 자동으로 확인해요.'
        : '계좌 번호를 모르면 대회 상세의 "문의"로 물어보거나 주최자 공지를 확인하세요.')

  return {
    applicable: true, done: false, status, amount,
    tone: 'pending', title: '입금 대기',
    payerName: myName || null,
    bank,
    steps, note,
  }
}
