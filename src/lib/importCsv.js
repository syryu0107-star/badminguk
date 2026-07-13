// ── 주최자 CSV 대회결과 임포터 (importCsv.js) ─────────────────────────
// docs/COLDSTART_STRATEGY.md 6-2·7장 TOP5 #1: "주최자 1명 업로드 = 참가자 수십명 온보딩".
// 콜드스타트 최대 지렛대. 순수 JS(무거운 라이브러리 금지). Supabase 호출 없음 —
// 이 파일은 파싱·인코딩·검증·미리보기·중복탐지·초기레이팅 산정의 "계산" 계층이고,
// DB IO(프로필 조회/원장 기록)는 페이지(ImportResults.jsx)가 담당한다.
//
// 합법성(전략 6-1): 크롤링 금지. 주최자가 "자기 대회" 데이터를 직접 올리는 것만.
//
// 재사용(재작성 금지):
//   · rating.js  : gradeToMMR(급수→초기 MMR+RD 밴드), crossCheckSandbag(급수↔급수).
//   · grades.js  : GRADES/getGradeIndex(급수 인덱스), SINGLES 판정.
// ⚠️ 초기 MMR·RD의 단일 소스는 rating.gradeToMMR. 여기서 밴드를 재정의하지 않는다.

import { gradeToMMR, crossCheckSandbag } from './rating'
import { GRADE_KEYS } from './grades'

// ══════════════════════════════════════════════════════════════════
// 0. 표준 템플릿 (전략 6-2)
//    선수명 · 성별 · 급수 · 종목(단/복) · 순위 · 상대 · 대회규모(팀수)
// ══════════════════════════════════════════════════════════════════
export const IMPORT_FIELDS = [
  { key: 'name',     header: '선수명',   required: true,  hint: '예) 홍길동' },
  { key: 'gender',   header: '성별',     required: false, hint: '남 / 여' },
  { key: 'grade',    header: '급수',     required: true,  hint: '왕초심~자강조 (또는 D·C·B·A)' },
  { key: 'mode',     header: '종목',     required: false, hint: '단 / 복 (미입력 시 복식)' },
  { key: 'rank',     header: '순위',     required: false, hint: '1=우승, 2=준우승, 3=3위…' },
  { key: 'opponent', header: '상대',     required: false, hint: '결승/최종 상대(선택)' },
  { key: 'drawSize', header: '대회규모', required: false, hint: '참가 팀 수(선택)' },
]

// 헤더 별칭 → 표준 필드. 사용자가 조금 다르게 써도 인식.
const HEADER_ALIASES = {
  name:     ['선수명', '이름', '성명', '선수', 'name', 'player'],
  gender:   ['성별', '성', 'gender', 'sex'],
  grade:    ['급수', '등급', '조', '부', 'grade', 'level', 'division'],
  mode:     ['종목', '단복', '단·복', '단/복', 'event', 'mode', 'type'],
  rank:     ['순위', '등수', '성적', '결과', 'rank', 'result', 'final_rank', 'placement'],
  opponent: ['상대', '상대선수', '결승상대', 'opponent', 'vs'],
  drawSize: ['대회규모', '팀수', '참가팀', '참가팀수', '규모', '대진규모', 'draw', 'drawsize', 'teams'],
}

// 다운로드용 표준 CSV(예시 2행 포함). UTF-8 BOM은 페이지에서 붙인다(엑셀 한글).
export const TEMPLATE_CSV =
  '선수명,성별,급수,종목,순위,상대,대회규모\n' +
  '홍길동,남,C조,복,1,김철수,32\n' +
  '이영희,여,B조,복,2,박민지,32\n'

// ══════════════════════════════════════════════════════════════════
// 1. 인코딩 자동감지 + 디코딩 (EUC-KR ↔ UTF-8)
//    엑셀 한글 CSV는 대개 EUC-KR(cp949), 웹/구글시트는 UTF-8. 한글 깨짐 방지.
//    입력은 File.arrayBuffer() 결과(ArrayBuffer). 붙여넣기 문자열은 이 단계 불필요.
// ══════════════════════════════════════════════════════════════════
export function decodeCsvBuffer(buf) {
  const bytes = new Uint8Array(buf)
  // UTF-8 BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' }
  }
  // UTF-8 엄격 디코딩 성공 → UTF-8. 실패(한글 EUC-KR 바이트) → EUC-KR 폴백.
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text, encoding: 'utf-8' }
  } catch {
    try {
      // 'euc-kr' 라벨은 브라우저에서 cp949로 매핑(한글 완성형).
      const text = new TextDecoder('euc-kr').decode(bytes)
      return { text, encoding: 'euc-kr' }
    } catch {
      // 최후: 관대한 UTF-8(치환문자 허용).
      return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' }
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// 2. CSV 파서 (RFC4180 근사, 순수 JS)
//    따옴표 필드 내부의 쉼표·줄바꿈·이스케이프("") 처리. BOM 제거.
//    반환: string[][] (행 → 셀 배열). 빈 줄은 제거.
// ══════════════════════════════════════════════════════════════════
export function parseCsvGrid(text) {
  const src = (text ?? '').replace(/^﻿/, '')
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ }  // 이스케이프된 따옴표
        else inQuotes = false
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++    // CRLF
      row.push(field); field = ''
      rows.push(row); row = []
    } else {
      field += c
    }
  }
  // 마지막 필드/행 flush
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  // 완전 빈 행 제거(모든 셀이 공백)
  return rows.filter(r => r.some(cell => (cell ?? '').trim() !== ''))
}

// ══════════════════════════════════════════════════════════════════
// 3. 정규화 헬퍼 (급수·종목·숫자)
// ══════════════════════════════════════════════════════════════════
function norm(s) { return (s ?? '').toString().trim() }
function nkey(s) { return norm(s).replace(/\s+/g, '').toLowerCase() }

// 급수 문자열 → GRADES key. "C","c","C조","씨","씨조" 등 관대 매핑. 못 찾으면 null.
const LETTER_TO_GRADE = { a: 'A조', b: 'B조', c: 'C조', d: 'D조' }
const KO_LETTER = { 에이: 'A조', 비: 'B조', 씨: 'C조', 디: 'D조' }
export function normalizeGrade(raw) {
  const k = nkey(raw)
  if (!k) return null
  // 정확 일치 (왕초심/초심/D조/…/자강조)
  const exact = GRADE_KEYS.find(g => nkey(g) === k)
  if (exact) return exact
  // '조' 붙은 형태 제거 후 재시도
  const noJo = k.replace(/조$/, '')
  const byNoJo = GRADE_KEYS.find(g => nkey(g).replace(/조$/, '') === noJo)
  if (byNoJo) return byNoJo
  // 영문 한 글자 A~D
  if (LETTER_TO_GRADE[noJo]) return LETTER_TO_GRADE[noJo]
  // 한글 자모 표기(씨/디…)
  if (KO_LETTER[noJo]) return KO_LETTER[noJo]
  // 초심/왕초심 축약
  if (noJo.includes('왕초')) return '왕초심'
  if (noJo.includes('초심') || noJo === '초보') return '초심'
  if (noJo.includes('자강')) return noJo.includes('준') ? '준자강' : '자강조'
  if (noJo.includes('준자')) return '준자강'
  return null
}

// 종목 문자열 → 'singles' | 'doubles'. 기본 복식.
export function normalizeMode(raw) {
  const k = nkey(raw)
  if (!k) return 'doubles'
  if (k.includes('복')) return 'doubles'          // 남복/여복/혼복/복식
  if (k.includes('단')) return 'singles'          // 남단/여단/단식
  if (k.includes('single') || k === 'sgl') return 'singles'
  return 'doubles'
}

function toInt(raw) {
  const m = norm(raw).replace(/[^\d]/g, '')
  return m ? parseInt(m, 10) : null
}

// 실명 마스킹 — 홍길동 → 홍*동 (017 SQL bmg_mask_name과 1:1 파리티).
//   0자→'' · 1자→그대로 · 2자→앞1+'*'(김철→김*) · 3자+→앞1 + '*'×(len-2) + 뒤1.
//   ⚠️ 미가입(imported) 선수 표시 전용. 가입 프로필은 동의했으므로 마스킹하지 않는다.
export function maskName(raw) {
  const s = norm(raw)
  if (s.length === 0) return ''
  if (s.length === 1) return s
  if (s.length === 2) return s[0] + '*'
  return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1]
}

// ══════════════════════════════════════════════════════════════════
// 4. 헤더 매핑 — 표준 필드 인덱스 찾기
//    반환: { indexByField, missingRequired, unmapped }
// ══════════════════════════════════════════════════════════════════
export function mapHeaders(headerRow = []) {
  const indexByField = {}
  const used = new Set()
  const heads = headerRow.map(h => nkey(h))
  for (const field of Object.keys(HEADER_ALIASES)) {
    const aliases = HEADER_ALIASES[field].map(nkey)
    const idx = heads.findIndex((h, i) => !used.has(i) && aliases.includes(h))
    if (idx >= 0) { indexByField[field] = idx; used.add(idx) }
  }
  const missingRequired = IMPORT_FIELDS
    .filter(f => f.required && indexByField[f.key] == null)
    .map(f => f.header)
  const unmapped = headerRow.filter((_, i) => !used.has(i)).map(norm).filter(Boolean)
  return { indexByField, missingRequired, unmapped }
}

// ══════════════════════════════════════════════════════════════════
// 5. 초기 레이팅 산정 (rating.gradeToMMR 위임 — 단일 소스)
//    급수 → { mmr, rd }. 종목 반영. mmr_source='import', provisional=true.
// ══════════════════════════════════════════════════════════════════
export function seedRating(grade, unit = 'gu', mode = 'doubles') {
  const band = gradeToMMR(grade ?? '왕초심', unit)   // { mmr, rd, floorMMR, ceilMMR }
  return {
    mmr: band.mmr,
    rd: band.rd,
    floorMMR: band.floorMMR,
    ceilMMR: band.ceilMMR,
    mode,
    source: 'import',
    provisional: true,
  }
}

// ══════════════════════════════════════════════════════════════════
// 6. 한 행 → 정규화 레코드 + 검증
// ══════════════════════════════════════════════════════════════════
export function normalizeRow(cells, indexByField, rowNumber) {
  const at = (field) => {
    const i = indexByField[field]
    return i == null ? '' : norm(cells[i])
  }
  const nameRaw = at('name')
  const gradeRaw = at('grade')
  const grade = normalizeGrade(gradeRaw)
  const mode = normalizeMode(at('mode'))
  const rank = toInt(at('rank'))
  const drawSize = toInt(at('drawSize'))
  const gender = at('gender')
  const opponent = at('opponent')

  const errors = []
  if (!nameRaw) errors.push('선수명 없음')
  if (!gradeRaw) errors.push('급수 없음')
  else if (!grade) errors.push(`급수 "${gradeRaw}" 인식 불가`)
  if (rank != null && rank < 1) errors.push('순위는 1 이상')

  return {
    rowNumber,
    name: nameRaw,
    gender,
    gradeRaw,
    grade,               // 정규화된 GRADES key 또는 null
    mode,                // 'singles' | 'doubles'
    rank,
    opponent,
    drawSize,
    errors,
    valid: errors.length === 0,
  }
}

// ══════════════════════════════════════════════════════════════════
// 7. 중복/동명이인 매칭 (기존 프로필과 대조)
//    existingProfiles: [{ id, name, phone, official_grade, grade_verified,
//                         mmr, mmr_games_played }]
//    이름 정규화 완전일치. 결과 status: new | matched(1명) | ambiguous(2명+).
//    ⚠️ 이름만으로는 동명이인 위험 → 2명+면 사람이 고르게 ambiguous로 남긴다.
// ══════════════════════════════════════════════════════════════════
export function buildNameIndex(existingProfiles = []) {
  const idx = new Map()
  for (const p of existingProfiles) {
    const key = nkey(p.name)
    if (!key) continue
    if (!idx.has(key)) idx.set(key, [])
    idx.get(key).push(p)
  }
  return idx
}

export function matchProfile(row, nameIndex) {
  const candidates = nameIndex.get(nkey(row.name)) ?? []
  if (candidates.length === 0) return { status: 'new', candidates: [] }
  if (candidates.length === 1) return { status: 'matched', candidates, chosen: candidates[0] }
  return { status: 'ambiguous', candidates }
}

// ══════════════════════════════════════════════════════════════════
// 8. 샌드배깅 교차검증 (매칭된 기존 프로필 있을 때만)
//    CSV 신고 급수가 이미 아는(더 높은) 프로필 급수보다 크게 낮으면 플래그.
//    rating.crossCheckSandbag(신고, 실제) 재사용: gap = 실제idx − 신고idx.
//    신규(미매칭) 선수는 사전 정보 없음 → 플래그 없음(경기 후 sandbag.js가 잡음).
// ══════════════════════════════════════════════════════════════════
export function crossCheckRow(row, chosenProfile) {
  if (!row.grade || !chosenProfile) return { flagged: false, gap: 0, level: 'none', reason: null }
  const actual = chosenProfile.official_grade
  if (!actual) return { flagged: false, gap: 0, level: 'none', reason: null }
  // 신고=CSV 급수, 실제=기존 프로필 급수
  return crossCheckSandbag(row.grade, actual)
}

// ══════════════════════════════════════════════════════════════════
// 9. 임포트 플랜 빌드 (미리보기의 단일 소스)
//    입력: { grid(string[][]), existingProfiles, unit }
//    출력: { ok, headerMap, items[], summary, error }
// ══════════════════════════════════════════════════════════════════
export function buildImportPlan({ grid = [], existingProfiles = [], unit = 'gu' } = {}) {
  if (!grid.length) {
    return { ok: false, error: '빈 파일이에요. 내용이 있는 CSV를 올려 주세요.', items: [], summary: emptySummary() }
  }
  const headerRow = grid[0]
  const headerMap = mapHeaders(headerRow)
  if (headerMap.missingRequired.length) {
    return {
      ok: false,
      error: `필수 열이 없어요: ${headerMap.missingRequired.join(', ')}. 표준 템플릿을 받아 형식을 맞춰 주세요.`,
      headerMap,
      items: [],
      summary: emptySummary(),
    }
  }

  const nameIndex = buildNameIndex(existingProfiles)
  const items = []
  // CSV 내부 중복(같은 이름 2행) 감지용
  const seenNames = new Map()

  for (let r = 1; r < grid.length; r++) {
    const row = normalizeRow(grid[r], headerMap.indexByField, r + 1)
    const match = matchProfile(row, nameIndex)
    const seed = row.grade ? seedRating(row.grade, unit, row.mode) : null
    const sandbag = match.status === 'matched' ? crossCheckRow(row, match.chosen) : { flagged: false, gap: 0, level: 'none', reason: null }

    // CSV 내부 동일 이름 중복 표시(오타/중복행 방어)
    const nk = nkey(row.name)
    const dupInFile = nk ? seenNames.has(nk) : false
    if (nk) seenNames.set(nk, (seenNames.get(nk) ?? 0) + 1)

    items.push({ ...row, match, seed, sandbag, dupInFile })
  }

  return { ok: true, headerMap, items, summary: summarize(items) }
}

function emptySummary() {
  return { total: 0, valid: 0, errors: 0, matched: 0, ambiguous: 0, newCount: 0, flagged: 0 }
}

function summarize(items) {
  const s = emptySummary()
  s.total = items.length
  for (const it of items) {
    if (!it.valid) { s.errors++; continue }   // 형식 오류행은 버킷에서 제외(과대집계 방지)
    s.valid++
    if (it.match.status === 'matched') s.matched++
    else if (it.match.status === 'ambiguous') s.ambiguous++
    else s.newCount++
    if (it.sandbag.flagged) s.flagged++
  }
  return s
}

// ══════════════════════════════════════════════════════════════════
// 10. 커밋 산출물 형태 (페이지가 Supabase로 기록)
//   · buildLedgerRow: imported_results(대장) INSERT용 객체.
//   · planToSeedRows: 참가자 프로필 시드 RPC 페이로드(jsonb rows).
//     ⚠️ 실제 프로필 생성/시드는 SECURITY DEFINER RPC 필요(RLS·auth.users FK).
//        아래 형태를 백엔드 계약으로 넘긴다(통합 전달사항 참고).
// ══════════════════════════════════════════════════════════════════
export function buildLedgerRow(plan, { tournamentId = null, fileName = null, uploadedBy, source = 'csv', status = 'pending', note = null } = {}) {
  const s = plan?.summary ?? emptySummary()
  return {
    tournament_id: tournamentId,
    uploaded_by: uploadedBy,
    source,
    file_name: fileName,
    row_count: s.total,
    matched_count: s.matched,
    created_count: s.newCount,
    status,
    note,
  }
}

// 신규+매칭 대상을 RPC용 최소 페이로드로. 오류행/ambiguous는 제외(사람 확인 필요).
export function planToSeedRows(plan) {
  return (plan?.items ?? [])
    .filter(it => it.valid && it.match.status !== 'ambiguous')
    .map(it => ({
      name: it.name,
      gender: it.gender || null,
      grade: it.grade,
      mode: it.mode,
      rank: it.rank,
      draw_size: it.drawSize,
      mmr: it.seed?.mmr ?? null,
      rd: it.seed?.rd ?? null,
      match_id: it.match.chosen?.id ?? null,   // 기존 프로필이면 그 id(병합), 없으면 신규
      is_new: it.match.status === 'new',
    }))
}
