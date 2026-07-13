import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/TopBar'
import GradeChip from '../../components/GradeChip'
import Spinner from '../../components/Spinner'
import {
  IMPORT_FIELDS, TEMPLATE_CSV,
  decodeCsvBuffer, parseCsvGrid, buildImportPlan,
  buildLedgerRow, planToSeedRows, maskName,
} from '../../lib/importCsv'
import {
  Upload, Download, FileSpreadsheet, ClipboardPaste, ShieldAlert, ShieldCheck,
  Check, AlertTriangle, Users, UserPlus, HelpCircle, Sparkles,
} from 'lucide-react'

// 매칭 상태별 배지 스타일
//   matched = "이미 가입한 회원" — 명단(imported_players)에는 담지 않고 중복 방지로 제외.
//   (기존 프로필 MMR 병합은 이 작업 범위 밖이라 '병합'이 아니라 '가입회원'으로 표기)
const MATCH_META = {
  new:       { label: '신규',       cls: 'text-[#003478] bg-blue-50' },
  matched:   { label: '가입회원',    cls: 'text-emerald-600 bg-emerald-50' },
  ambiguous: { label: '동명이인 확인', cls: 'text-amber-600 bg-amber-50' },
}

export default function ImportResults() {
  const { id } = useParams()                     // 대회 id (라우트 /organizer/:id/import)
  const [tournament, setTournament] = useState(null)
  const [profiles, setProfiles] = useState([])   // 기존 프로필(매칭용)
  const [loading, setLoading] = useState(true)

  const [fileName, setFileName] = useState(null)
  const [encoding, setEncoding] = useState(null)
  const [rawText, setRawText] = useState('')     // 붙여넣기/디코딩된 원문
  const [pasteMode, setPasteMode] = useState(false)
  const [consent, setConsent] = useState(false)  // 타인 PII 동의
  const [committing, setCommitting] = useState(false)
  const [result, setResult] = useState(null)     // { ok, matched, created, seeded, pending, error }
  const fileRef = useRef(null)

  const unit = tournament?.unit ?? 'gu'

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const [{ data: tour }, { data: ps }] = await Promise.all([
          supabase.from('tournaments').select('id,title,unit,organizer_id').eq('id', id).maybeSingle(),
          supabase.from('profiles')
            .select('id,name,phone,official_grade,grade_verified,mmr,mmr_games_played')
            .limit(10000),
        ])
        if (!alive) return
        setTournament(tour ?? null)
        setProfiles(ps ?? [])
      } catch { /* 매칭 없이도 진행 가능 */ }
      if (alive) setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [id])

  // 미리보기 플랜 — 원문(rawText) + 기존 프로필 + 대회 단위로 계산
  const plan = useMemo(() => {
    if (!rawText.trim()) return null
    const grid = parseCsvGrid(rawText)
    return buildImportPlan({ grid, existingProfiles: profiles, unit })
  }, [rawText, profiles, unit])

  const summary = plan?.summary

  // ── 파일 업로드 → 인코딩 감지 → 디코딩 → rawText ─────────────────
  async function onFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setResult(null); setConsent(false)
    const buf = await f.arrayBuffer()
    const { text, encoding: enc } = decodeCsvBuffer(buf)
    setFileName(f.name)
    setEncoding(enc)
    setRawText(text)
    setPasteMode(false)
  }

  function onPaste(v) {
    setResult(null); setConsent(false)
    setRawText(v)
    setFileName(null)
    setEncoding('utf-8')
  }

  function downloadTemplate() {
    // 엑셀 한글 깨짐 방지: UTF-8 BOM 부착
    const blob = new Blob(['﻿' + TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = '배드민국_대회결과_템플릿.csv'
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  // ── 가져오기: imported_results(대장) 기록 + 미가입 선수 명단 시드 RPC ──
  //   미가입 선수는 profiles(auth.users FK)에 넣을 수 없어 imported_players 명단에 담는다.
  //   RLS상 명단 INSERT는 SECURITY DEFINER RPC(bmg_import_participants, 017)로만.
  //   RPC가 아직 없으면(구버전 DB) 대장만 남기고 "명단 등재 대기"로 정직 안내.
  async function commit() {
    if (!plan?.ok || committing) return
    setCommitting(true)
    setResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id
      if (!uid) throw new Error('로그인이 필요해요.')

      // 1) 대장(ledger) 먼저 — 감사·되돌리기 앵커. 항상 남긴다(상태 pending).
      const ledger = buildLedgerRow(plan, {
        tournamentId: id, fileName, uploadedBy: uid, source: 'csv', status: 'pending',
        note: `단위 ${unit} · 신규 ${summary.newCount} · 병합 ${summary.matched} · 확인필요 ${summary.ambiguous + summary.errors}`,
      })
      const { data: ins, error: insErr } = await supabase
        .from('imported_results').insert(ledger).select('id').single()
      if (insErr) throw insErr
      const importId = ins.id

      // 2) 미가입 선수 명단 시드 — 백엔드 RPC(017) 위임.
      //    is_new 행만 imported_players에 담기고, 이미 가입한(matched) 회원은
      //    중복 방지로 제외된다. 초기 MMR/RD/급수는 RPC가 SQL 헬퍼로 재산정.
      //    RPC 미배포(구버전 DB) 시엔 대장만 남기고 '등재 대기'로 정직 안내.
      const rows = planToSeedRows(plan)
      let seeded = false
      let matched = summary.matched, created = summary.newCount, skipped = 0
      let seededList = []
      try {
        const { data: rpc, error: rpcErr } = await supabase.rpc('bmg_import_participants', {
          p_import_id: importId, p_unit: unit, p_rows: rows,
        })
        if (rpcErr) throw rpcErr
        seeded = true
        matched = rpc?.matched ?? matched
        created = rpc?.created ?? created
        skipped = rpc?.skipped ?? 0

        // 실제로 명단에 담긴 행을 되읽어 마스킹 목록을 만든다(공개 SELECT).
        //   source_import_id로 이번 임포트가 만든 행만 정확히 집는다.
        const { data: seededRows } = await supabase
          .from('imported_players')
          .select('id,name,grade,mode,mmr')
          .eq('source_import_id', importId)
          .order('mmr', { ascending: false })
        seededList = (seededRows ?? []).map(r => ({
          id: r.id,
          nameMasked: maskName(r.name),
          grade: r.grade,
          mode: r.mode,
          mmr: r.mmr,
        }))

        // 대장(016) 갱신 — 명단 등재 완료(merged) + 실제 카운트.
        await supabase.from('imported_results')
          .update({ status: 'merged', matched_count: matched, created_count: created })
          .eq('id', importId)
      } catch (rpcErr) {
        // RPC 미배포(PGRST202 등) → 대장은 남았고 명단 등재만 대기. 정직하게 알림.
        seeded = false
      }

      setResult({ ok: true, seeded, matched, created, skipped, seededList, importId })
    } catch (err) {
      setResult({ ok: false, error: err?.message ?? '가져오기에 실패했어요.' })
    }
    setCommitting(false)
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>

  const canCommit = plan?.ok && consent && summary?.valid > 0 && !committing

  return (
    <div className="safe-bottom pb-24">
      <TopBar title="대회결과 가져오기" />

      {/* 안내 — 초보 주최자용 */}
      <div className="px-4 pt-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-start gap-2">
            <Sparkles size={18} className="text-[#C60C30] mt-0.5 shrink-0" />
            <div>
              <p className="font-bold text-sm">한 번 올리면 참가자 전원이 명단에 담겨요</p>
              <p className="text-xs text-gray-500 leading-relaxed mt-0.5">
                내 대회의 <b>결과표(엑셀·CSV)</b>를 올리면 아직 <b>가입 안 한 선수</b>도 명단에 담기고,
                급수를 바탕으로 <b>초기 실력점수(MMR)</b>가 매겨져 랭킹에 이름을 가려(예: 홍*동) 보여줘요.
                본인이 가입하면 그 기록을 <b>자기 프로필로 이어받습니다</b>.
              </p>
              <p className="text-[11px] text-gray-400 leading-relaxed mt-1.5">
                내 대회 데이터만 올려 주세요(다른 사이트 크롤링·타인 대회 무단 업로드 금지).
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 템플릿 다운로드 + 형식 안내 */}
      <div className="px-4 pt-3">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <FileSpreadsheet size={18} className="text-[#003478] mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-bold text-sm">표준 양식</p>
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                  {IMPORT_FIELDS.map(f => f.header).join(' · ')}
                </p>
              </div>
            </div>
            <button
              onClick={downloadTemplate}
              className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl bg-gray-100 text-gray-700
                         text-xs font-bold active:opacity-80"
            >
              <Download size={14} /> 양식 받기
            </button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-1">
            {IMPORT_FIELDS.map(f => (
              <div key={f.key} className="flex items-center gap-2 text-[11px]">
                <span className={`w-14 shrink-0 font-semibold ${f.required ? 'text-[#C60C30]' : 'text-gray-400'}`}>
                  {f.header}{f.required && ' *'}
                </span>
                <span className="text-gray-400">{f.hint}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 업로드 / 붙여넣기 */}
      <div className="px-4 pt-3">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setPasteMode(false)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold transition
                          ${!pasteMode ? 'bg-[#003478] text-white' : 'bg-gray-100 text-gray-500'}`}
            >
              <Upload size={15} /> 파일 올리기
            </button>
            <button
              onClick={() => setPasteMode(true)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold transition
                          ${pasteMode ? 'bg-[#003478] text-white' : 'bg-gray-100 text-gray-500'}`}
            >
              <ClipboardPaste size={15} /> 붙여넣기
            </button>
          </div>

          {!pasteMode ? (
            <div>
              <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" onChange={onFile} className="hidden" />
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-200 rounded-xl py-8 flex flex-col items-center
                           gap-2 text-gray-400 active:bg-gray-50"
              >
                <Upload size={26} />
                <span className="text-sm font-semibold text-gray-600">CSV 파일 선택</span>
                <span className="text-[11px]">엑셀에서 "다른 이름으로 저장 → CSV"</span>
              </button>
              {fileName && (
                <p className="mt-2 text-xs text-gray-500 flex items-center gap-1.5 flex-wrap">
                  <Check size={13} className="text-emerald-500" /> {fileName}
                  {encoding && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                      {encoding === 'euc-kr' ? '한글(EUC-KR) 자동변환' : 'UTF-8'}
                    </span>
                  )}
                </p>
              )}
            </div>
          ) : (
            <textarea
              value={rawText}
              onChange={e => onPaste(e.target.value)}
              rows={6}
              placeholder={'표 내용을 그대로 붙여넣으세요(쉼표 CSV)\n선수명,성별,급수,종목,순위,상대,대회규모\n홍길동,남,C조,복,1,김철수,32'}
              className="w-full text-sm rounded-xl border border-gray-200 p-3 leading-relaxed font-mono
                         focus:outline-none focus:ring-2 focus:ring-[#003478]/30 resize-none"
            />
          )}
        </div>
      </div>

      {/* 파싱 에러(형식 문제) */}
      {plan && !plan.ok && (
        <div className="px-4 pt-3">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-2">
            <AlertTriangle size={18} className="text-[#C60C30] mt-0.5 shrink-0" />
            <p className="text-sm text-red-700 leading-relaxed">{plan.error}</p>
          </div>
        </div>
      )}

      {/* 미리보기 */}
      {plan?.ok && summary && (
        <>
          {/* 요약 타일 */}
          <div className="px-4 pt-3">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="grid grid-cols-4 gap-1.5 text-center">
                {[
                  { n: summary.total,     label: '전체',     cls: 'text-gray-700' },
                  { n: summary.newCount,  label: '명단 등재', cls: 'text-[#003478]' },
                  { n: summary.matched,   label: '가입회원', cls: 'text-emerald-600' },
                  { n: summary.errors + summary.ambiguous, label: '확인 필요', cls: 'text-amber-600' },
                ].map(b => (
                  <div key={b.label} className="bg-gray-50 rounded-xl py-2">
                    <p className={`text-lg font-black ${b.cls}`}>{b.n}</p>
                    <p className="text-[11px] text-gray-400">{b.label}</p>
                  </div>
                ))}
              </div>
              {summary.flagged > 0 && (
                <p className="mt-2.5 text-xs text-red-600 flex items-center gap-1">
                  <ShieldAlert size={13} /> 급수 사기 의심 {summary.flagged}건 — 신고 급수가 기존 실력보다 낮아요. 확인하세요.
                </p>
              )}
              {summary.errors > 0 && (
                <p className="mt-1 text-xs text-amber-600 flex items-center gap-1">
                  <AlertTriangle size={13} /> {summary.errors}행은 형식 오류로 제외돼요(선수명·급수 확인).
                </p>
              )}
            </div>
          </div>

          {/* 미리보기 표 */}
          <div className="px-4 pt-3">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-50 flex items-center gap-2">
                <Users size={15} className="text-gray-400" />
                <p className="text-xs font-bold text-gray-600">미리보기 ({summary.total}명)</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs whitespace-nowrap">
                  <thead>
                    <tr className="text-[11px] text-gray-400 border-b border-gray-50">
                      <th className="text-left font-semibold px-3 py-2">선수</th>
                      <th className="text-left font-semibold px-2 py-2">급수</th>
                      <th className="text-left font-semibold px-2 py-2">종목</th>
                      <th className="text-right font-semibold px-2 py-2">시작 MMR</th>
                      <th className="text-left font-semibold px-3 py-2">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.items.map((it, i) => {
                      const m = MATCH_META[it.match.status]
                      return (
                        <tr key={i} className={`border-b border-gray-50 ${!it.valid ? 'opacity-50' : ''}`}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-gray-800">{it.name || '—'}</span>
                              {it.gender && <span className="text-[10px] text-gray-400">{it.gender}</span>}
                              {it.dupInFile && <span className="text-[10px] text-amber-500">중복행</span>}
                            </div>
                            {it.errors.length > 0 && (
                              <p className="text-[10px] text-red-500 mt-0.5">{it.errors.join(', ')}</p>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            {it.grade
                              ? <GradeChip grade={it.grade} size="sm" />
                              : <span className="text-red-400">{it.gradeRaw || '—'}</span>}
                          </td>
                          <td className="px-2 py-2 text-gray-500">{it.mode === 'singles' ? '단식' : '복식'}</td>
                          <td className="px-2 py-2 text-right">
                            {it.seed
                              ? <span className="font-bold text-gray-800">
                                  {it.seed.mmr}
                                  <span className="text-[10px] text-gray-400 font-normal"> ±{it.seed.rd}</span>
                                </span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1 flex-wrap">
                              {m && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${m.cls}`}>{m.label}</span>}
                              {it.sandbag.flagged && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-red-600 bg-red-50 flex items-center gap-0.5">
                                  <ShieldAlert size={9} /> 급수의심
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* 동명이인 안내 */}
          {summary.ambiguous > 0 && (
            <div className="px-4 pt-3">
              <p className="text-xs text-amber-600 bg-amber-50 rounded-xl px-3 py-2 flex items-start gap-1.5">
                <HelpCircle size={13} className="mt-0.5 shrink-0" />
                이름이 같은 기존 회원이 여러 명인 {summary.ambiguous}건은 자동 병합하지 않고 넘어가요(동명이인 오병합 방지).
              </p>
            </div>
          )}

          {/* PII 동의 */}
          <div className="px-4 pt-3">
            <label className="flex items-start gap-2.5 bg-white rounded-2xl border border-gray-100 shadow-sm p-4 cursor-pointer">
              <input
                type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[#003478]"
              />
              <span className="text-xs text-gray-600 leading-relaxed">
                이 명단은 <b>내가 주최한 대회의 참가자</b>이며, 이름 등 개인정보를 배드민국에 등록하는 데
                문제가 없음을 확인합니다. (참가자 동의·개인정보 최소수집 원칙 준수)
              </span>
            </label>
          </div>
        </>
      )}

      {/* 결과 */}
      {result && (
        <div className="px-4 pt-3">
          {result.ok ? (
            <div className={`rounded-2xl border p-4 ${result.seeded ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-200'}`}>
              <div className="flex items-start gap-2">
                {result.seeded
                  ? <ShieldCheck size={18} className="text-emerald-600 mt-0.5 shrink-0" />
                  : <Check size={18} className="text-[#003478] mt-0.5 shrink-0" />}
                <div className="min-w-0">
                  {result.seeded ? (
                    <>
                      <p className="font-bold text-sm text-emerald-700">
                        {result.created}명 명단 등재 완료
                      </p>
                      <p className="text-xs text-emerald-600 mt-0.5 leading-relaxed">
                        이들이 배드민국에 <b>가입하면</b> 이 대회의 급수·기록을 <b>본인 프로필로 이어받아요</b>.
                        그전까지는 랭킹에 이름을 가려(예: 홍*동) 보여줘요.
                      </p>
                      {result.matched > 0 && (
                        <p className="text-[11px] text-gray-500 mt-1.5">
                          이미 가입한 회원 {result.matched}명은 명단에서 제외했어요(중복 방지).
                        </p>
                      )}
                      {result.skipped > 0 && (
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          형식 오류·중복 {result.skipped}건은 건너뛰었어요.
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="font-bold text-sm text-[#003478]">업로드 기록됨 · 명단 등재 대기</p>
                      <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                        업로드 내역은 저장됐어요(등재 예정 {result.created}명 · 이미 가입 {result.matched}명).
                        미가입 선수 <b>명단 등재</b>는 서버 준비가 끝나면 반영돼요.
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* 등재된 선수 마스킹 목록 */}
              {result.seeded && result.seededList?.length > 0 && (
                <div className="mt-3 pt-3 border-t border-emerald-100">
                  <p className="text-[11px] font-bold text-emerald-700 mb-2 flex items-center gap-1">
                    <Users size={12} /> 명단에 담긴 선수
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.seededList.map(p => (
                      <span
                        key={p.id}
                        className="inline-flex items-center gap-1 bg-white border border-emerald-100 rounded-full pl-2 pr-2 py-1"
                      >
                        <span className="text-xs font-semibold text-gray-700">{p.nameMasked}</span>
                        {p.grade && <GradeChip grade={p.grade} size="sm" />}
                        <span className="text-[10px] text-gray-400">{p.mode === 'singles' ? '단' : '복'}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-2">
              <AlertTriangle size={18} className="text-[#C60C30] mt-0.5 shrink-0" />
              <p className="text-sm text-red-700">{result.error}</p>
            </div>
          )}
        </div>
      )}

      {/* 가져오기 버튼 (하단 고정) */}
      {plan?.ok && summary?.valid > 0 && !result?.ok && (
        <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto px-4 pb-4 pt-3 bg-gradient-to-t from-white via-white to-transparent">
          <button
            onClick={commit}
            disabled={!canCommit}
            className="w-full py-3.5 rounded-2xl text-white text-sm font-black active:scale-[.98] transition
                       disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: '#C60C30' }}
          >
            {committing
              ? '명단에 담는 중…'
              : <><UserPlus size={17} /> 미가입 {summary.newCount}명 명단 등재</>}
          </button>
          {!consent && (
            <p className="text-center text-[11px] text-gray-400 mt-1.5">위 개인정보 동의에 체크하면 활성화돼요</p>
          )}
        </div>
      )}
    </div>
  )
}
