import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Monitor, Play, Clock, ChevronRight, RefreshCw, Moon, Sun } from 'lucide-react';
import { supabase } from '../../lib/supabase';

/* ══════════════════════════════════════════════════════════════
   Constants
══════════════════════════════════════════════════════════════ */
const REFRESH_MS = 15_000;

const C = {
  primary:   '#003478',
  primaryHi: '#1a5fbf',
  green:     '#22c55e',
  greenDim:  '#16a34a',
  amber:     '#f59e0b',
  gray:      '#6b7280',
};

/* ══════════════════════════════════════════════════════════════
   Helpers
══════════════════════════════════════════════════════════════ */
const fmtTime = (iso) =>
  iso
    ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : '–';

const elapsedMin = (startedAt) =>
  startedAt ? Math.floor((Date.now() - new Date(startedAt)) / 60_000) : null;

const getCourtStatus = (current) => {
  if (!current) return 'EMPTY';
  if (current.status === 'in_progress') return 'IN_PROGRESS';
  return 'PREPARING_NEXT';
};

const STATUS_META = {
  EMPTY:          { label: '비어있음', color: C.gray   },
  IN_PROGRESS:    { label: '경기 중',  color: C.green  },
  PREPARING_NEXT: { label: '대기 중',  color: C.amber  },
};

/* ══════════════════════════════════════════════════════════════
   Global CSS (scoped via .cv- prefix)
══════════════════════════════════════════════════════════════ */
const STYLES = `
  .cv-root * { box-sizing: border-box; }
  .cv-root {
    font-family: "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  @keyframes cv-spin  { to { transform: rotate(360deg); } }
  @keyframes cv-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
  @keyframes cv-glow  {
    0%,100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.35); }
    50%     { box-shadow: 0 0 0 10px rgba(34,197,94,0);  }
  }

  .cv-icon-btn {
    background: rgba(255,255,255,0.12);
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 8px;
    padding: 9px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
    flex-shrink: 0;
  }
  .cv-icon-btn:hover      { background: rgba(255,255,255,0.22); }
  .cv-icon-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

  .cv-start-btn {
    width: 100%;
    padding: 15px 20px;
    background: #003478;
    color: #fff;
    border: none;
    border-radius: 10px;
    font-size: 19px;
    font-weight: 700;
    letter-spacing: 0.02em;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    transition: background 0.15s, transform 0.1s;
  }
  .cv-start-btn:hover      { background: #1a5fbf; transform: translateY(-1px); }
  .cv-start-btn:active     { transform: translateY(0); }
  .cv-start-btn:focus-visible { outline: 3px solid #22c55e; outline-offset: 2px; }

  .cv-assign-chip {
    background: #003478;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .cv-assign-chip:hover    { background: #1a5fbf; }
  .cv-assign-chip:disabled { opacity: 0.5; cursor: not-allowed; }

  .cv-uncard {
    cursor: grab;
    transition: transform 0.15s, box-shadow 0.15s;
    user-select: none;
  }
  .cv-uncard:hover  { transform: translateY(-2px); }
  .cv-uncard:active { cursor: grabbing; }

  .cv-court-card {
    transition: box-shadow 0.25s, border-color 0.2s;
  }
  .cv-court-card:focus-visible { outline: 3px solid #22c55e; outline-offset: 2px; }
`;

/* ══════════════════════════════════════════════════════════════
   Component
══════════════════════════════════════════════════════════════ */
export default function CourtView() {
  const { id: tournamentId } = useParams();

  const [dark, setDark]               = useState(true);
  const [tournament, setTournament]   = useState(null);
  const [courts, setCourts]           = useState({});       // { courtNum: { current, next } }
  const [unassigned, setUnassigned]   = useState([]);
  const [stats, setStats]             = useState({ total: 0, done: 0 });
  const [loading, setLoading]         = useState(true);
  const [refreshAt, setRefreshAt]     = useState(null);
  const [dragOver, setDragOver]       = useState(null);     // court number being hovered
  const [assigning, setAssigning]     = useState(false);
  const [, setTick]                   = useState(0);        // drives elapsed-time re-renders

  const dragMatch = useRef(null);

  /* ── Theme tokens ─────────────────────────────────────────── */
  const T = dark
    ? {
        bg:       '#0b1426',
        surface:  '#131f35',
        border:   '#1e3054',
        text:     '#f0f4fb',
        sub:      '#7b9cbf',
        headerBg: '#091020',
        chipBg:   'rgba(0,52,120,0.4)',
        chipText: '#7baef5',
      }
    : {
        bg:       '#eef2f8',
        surface:  '#ffffff',
        border:   '#d1ddef',
        text:     '#0c1a2e',
        sub:      '#5a7a9e',
        headerBg: C.primary,
        chipBg:   'rgba(0,52,120,0.08)',
        chipText: C.primary,
      };

  /* ── Fetch ────────────────────────────────────────────────── */
  const fetchData = useCallback(async () => {
    if (!tournamentId) return;

    const [{ data: t }, { data: raw = [] }] = await Promise.all([
      supabase.from('tournaments').select('id, name').eq('id', tournamentId).single(),
      supabase
        .from('tournament_matches')
        .select('id, court_number, status, team_a_name, team_b_name, score_a, score_b, scheduled_time, started_at, category_name')
        .eq('tournament_id', tournamentId)
        .order('scheduled_time', { ascending: true }),
    ]);

    if (t) setTournament(t);

    const matches = raw ?? [];
    setStats({
      total: matches.length,
      done:  matches.filter(m => m.status === 'completed').length,
    });

    // All court numbers ever used in this tournament (including completed)
    const courtNums = [
      ...new Set(matches.filter(m => m.court_number != null).map(m => m.court_number)),
    ].sort((a, b) => a - b);

    // Build court map: for each court, find current + next non-completed match
    const map = {};
    for (const cn of courtNums) {
      const active = matches
        .filter(m => m.court_number === cn && m.status !== 'completed')
        .sort((a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time));
      const live  = active.find(m => m.status === 'in_progress');
      const sched = active.filter(m => m.status === 'scheduled');
      map[cn] = {
        current: live ?? sched[0] ?? null,
        next:    live ? sched[0] ?? null : sched[1] ?? null,
      };
    }
    setCourts(map);

    // Unassigned = scheduled matches with no court yet
    setUnassigned(matches.filter(m => m.court_number == null && m.status === 'scheduled'));

    setLoading(false);
    setRefreshAt(new Date());
  }, [tournamentId]);

  /* ── Auto-refresh ─────────────────────────────────────────── */
  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  /* ── Elapsed timer (30s tick to keep "X분 경과" current) ──── */
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  /* ── Realtime subscription ────────────────────────────────── */
  useEffect(() => {
    if (!tournamentId) return;
    const channel = supabase
      .channel(`court-view-${tournamentId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournament_matches', filter: `tournament_id=eq.${tournamentId}` },
        fetchData,
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tournamentId, fetchData]);

  /* ── Actions ──────────────────────────────────────────────── */
  async function startMatch(matchId) {
    await supabase
      .from('tournament_matches')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', matchId);
    fetchData();
  }

  async function assignToCourt(matchId, courtNumber) {
    setAssigning(true);
    await supabase
      .from('tournament_matches')
      .update({ court_number: courtNumber })
      .eq('id', matchId);
    setAssigning(false);
    fetchData();
  }

  /* ── Drag handlers ────────────────────────────────────────── */
  function onDragStart(match) { dragMatch.current = match; }
  function onDragEnd()        { dragMatch.current = null; setDragOver(null); }

  function onDrop(courtNum) {
    if (!dragMatch.current) return;
    assignToCourt(dragMatch.current.id, courtNum);
    setDragOver(null);
    dragMatch.current = null;
  }

  /* ── Derived layout values ────────────────────────────────── */
  const courtEntries = Object.entries(courts).sort(([a], [b]) => Number(a) - Number(b));
  const gridCols     = courtEntries.length <= 4 ? 2 : 4;
  const freeCourts   = courtEntries.filter(([, { current }]) => !current);
  const pct          = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

  /* ── Loading ──────────────────────────────────────────────── */
  if (loading) {
    return (
      <div
        className="cv-root"
        style={{ background: '#0b1426', alignItems: 'center', justifyContent: 'center', gap: 20 }}
      >
        <style>{STYLES}</style>
        <RefreshCw size={48} color="#7b9cbf" style={{ animation: 'cv-spin 1s linear infinite' }} />
        <p style={{ color: '#7b9cbf', fontSize: 24, margin: 0, fontFamily: 'system-ui' }}>
          로딩 중...
        </p>
      </div>
    );
  }

  /* ── Render ───────────────────────────────────────────────── */
  return (
    <>
      <style>{STYLES}</style>

      <div className="cv-root" style={{ background: T.bg, color: T.text }}>

        {/* ──── Header ───────────────────────────────────────── */}
        <header style={{
          background:     T.headerBg,
          borderBottom:   `3px solid ${C.primary}`,
          padding:        '18px 32px',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          gap:            24,
          flexShrink:     0,
        }}>
          {/* Title block */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
            <div style={{
              background:   'rgba(255,255,255,0.1)',
              borderRadius: 12,
              padding:      '10px 12px',
              display:      'flex',
              flexShrink:   0,
            }}>
              <Monitor size={32} color="#fff" />
            </div>
            <div style={{ minWidth: 0 }}>
              <h1 style={{
                margin:       0,
                fontSize:     30,
                fontWeight:   800,
                color:        '#fff',
                lineHeight:   1.1,
                letterSpacing: '-0.3px',
                overflow:     'hidden',
                textOverflow: 'ellipsis',
                whiteSpace:   'nowrap',
              }}>
                {tournament?.name ?? '대회 코트 현황'}
              </h1>
              <p style={{ margin: '4px 0 0', fontSize: 15, color: 'rgba(255,255,255,0.5)' }}>
                실시간 코트 배정 및 경기 현황판
              </p>
            </div>
          </div>

          {/* Right controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexShrink: 0 }}>
            {/* Progress counter */}
            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontSize:           38,
                fontWeight:         900,
                color:              '#fff',
                lineHeight:         1,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {stats.done}
                <span style={{ fontSize: 20, fontWeight: 400, opacity: 0.5 }}>
                  {' '}/ {stats.total}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
                경기 완료
              </div>
              {/* Progress bar */}
              <div style={{
                height:       5,
                width:        120,
                background:   'rgba(255,255,255,0.15)',
                borderRadius: 3,
                marginTop:    7,
                marginLeft:   'auto',
                overflow:     'hidden',
              }}>
                <div style={{
                  height:      '100%',
                  background:   C.green,
                  borderRadius: 3,
                  width:        `${pct}%`,
                  transition:  'width 0.6s ease',
                }} />
              </div>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={fetchData} className="cv-icon-btn" title="새로고침">
                <RefreshCw size={20} color="#fff" />
              </button>
              <button onClick={() => setDark(d => !d)} className="cv-icon-btn" title="테마 전환">
                {dark ? <Sun size={20} color="#fff" /> : <Moon size={20} color="#fff" />}
              </button>
            </div>
          </div>
        </header>

        {/* ──── Main ─────────────────────────────────────────── */}
        <main style={{ flex: 1, padding: '24px 28px', overflowY: 'auto' }}>

          {/* Empty state */}
          {courtEntries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '80px 0', color: T.sub, fontSize: 20 }}>
              배정된 코트 정보가 없습니다
            </div>
          ) : (
            <div style={{
              display:             'grid',
              gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
              gap:                 20,
            }}>
              {courtEntries.map(([cnStr, { current, next }]) => {
                const cn      = Number(cnStr);
                const status  = getCourtStatus(current);
                const meta    = STATUS_META[status];
                const isLive  = status === 'IN_PROGRESS';
                const isEmpty = status === 'EMPTY';
                const isDrop  = dragOver === cn;
                const elapsed = elapsedMin(current?.started_at);

                return (
                  <div
                    key={cn}
                    className="cv-court-card"
                    tabIndex={isEmpty ? 0 : undefined}
                    aria-label={`코트 ${cn} — ${meta.label}`}
                    style={{
                      background:    isDrop ? `${C.green}0d` : T.surface,
                      border:        isLive
                                       ? `2px solid ${C.green}`
                                       : isDrop
                                       ? `2px dashed ${C.green}`
                                       : `1px solid ${T.border}`,
                      borderRadius:  18,
                      padding:       '24px 26px',
                      display:       'flex',
                      flexDirection: 'column',
                      boxShadow:     isLive
                                       ? '0 4px 28px rgba(34,197,94,0.18)'
                                       : '0 2px 10px rgba(0,0,0,0.14)',
                      animation:     isLive ? 'cv-glow 3s ease-in-out infinite' : 'none',
                      transition:    'background 0.2s, border-color 0.2s',
                    }}
                    onDragOver={isEmpty ? (e) => { e.preventDefault(); setDragOver(cn); } : undefined}
                    onDragLeave={isEmpty ? () => setDragOver(v => v === cn ? null : v) : undefined}
                    onDrop={isEmpty ? () => onDrop(cn) : undefined}
                  >
                    {/* Court # + status badge */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{
                          fontSize:      12,
                          fontWeight:    700,
                          letterSpacing: 2.5,
                          color:         T.sub,
                          textTransform: 'uppercase',
                          marginBottom:  -6,
                        }}>
                          Court
                        </div>
                        {/* Giant court number — color IS the status signal */}
                        <div style={{
                          fontSize:           88,
                          fontWeight:         900,
                          lineHeight:         1,
                          color:              meta.color,
                          fontVariantNumeric: 'tabular-nums',
                          textShadow:         isLive ? `0 0 48px ${C.green}55` : 'none',
                          transition:         'color 0.4s, text-shadow 0.4s',
                        }}>
                          {cn}
                        </div>
                      </div>

                      {/* Status badge */}
                      <div style={{
                        marginTop:   10,
                        background:  `${meta.color}1a`,
                        border:      `1px solid ${meta.color}44`,
                        color:        meta.color,
                        borderRadius: 8,
                        padding:     '7px 14px',
                        fontSize:     14,
                        fontWeight:   700,
                        display:     'flex',
                        alignItems:  'center',
                        gap:          7,
                        whiteSpace:  'nowrap',
                      }}>
                        {isLive && (
                          <span style={{
                            width:        8,
                            height:       8,
                            background:   C.green,
                            borderRadius: '50%',
                            display:      'inline-block',
                            animation:    'cv-pulse 1.5s ease-in-out infinite',
                          }} />
                        )}
                        {meta.label}
                      </div>
                    </div>

                    {/* Current match */}
                    {current ? (
                      <div style={{ marginTop: 2 }}>
                        {/* Teams + score */}
                        <div style={{
                          display:    'flex',
                          alignItems: 'center',
                          gap:         12,
                          padding:    '14px 0',
                        }}>
                          <div style={{ flex: 1, textAlign: 'center' }}>
                            <div style={{
                              fontSize:   24,
                              fontWeight: 800,
                              color:      T.text,
                              lineHeight: 1.25,
                              wordBreak:  'break-word',
                            }}>
                              {current.team_a_name ?? '팀 A'}
                            </div>
                          </div>

                          {/* Score or vs */}
                          <div style={{ textAlign: 'center', minWidth: 96, flexShrink: 0 }}>
                            {isLive ? (
                              <div style={{
                                fontSize:           44,
                                fontWeight:         900,
                                lineHeight:         1,
                                letterSpacing:      3,
                                fontVariantNumeric: 'tabular-nums',
                              }}>
                                <span style={{
                                  color: (current.score_a ?? 0) >= (current.score_b ?? 0)
                                    ? C.green : T.sub,
                                }}>
                                  {current.score_a ?? 0}
                                </span>
                                <span style={{ color: T.border, margin: '0 3px', fontSize: 30 }}>:</span>
                                <span style={{
                                  color: (current.score_b ?? 0) > (current.score_a ?? 0)
                                    ? C.green : T.sub,
                                }}>
                                  {current.score_b ?? 0}
                                </span>
                              </div>
                            ) : (
                              <span style={{ fontSize: 20, color: T.sub, fontWeight: 300 }}>vs</span>
                            )}
                          </div>

                          <div style={{ flex: 1, textAlign: 'center' }}>
                            <div style={{
                              fontSize:   24,
                              fontWeight: 800,
                              color:      T.text,
                              lineHeight: 1.25,
                              wordBreak:  'break-word',
                            }}>
                              {current.team_b_name ?? '팀 B'}
                            </div>
                          </div>
                        </div>

                        {/* Meta info row */}
                        <div style={{
                          display:        'flex',
                          justifyContent: 'center',
                          alignItems:     'center',
                          flexWrap:       'wrap',
                          gap:            10,
                          fontSize:       13,
                          color:          T.sub,
                        }}>
                          {current.category_name && (
                            <span style={{
                              background:   T.chipBg,
                              color:        T.chipText,
                              borderRadius: 5,
                              padding:      '3px 9px',
                              fontWeight:   600,
                              fontSize:     12,
                            }}>
                              {current.category_name}
                            </span>
                          )}
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Clock size={13} />
                            {isLive
                              ? `${fmtTime(current.started_at)} 시작`
                              : `${fmtTime(current.scheduled_time)} 예정`}
                          </span>
                          {elapsed !== null && (
                            <span style={{ color: C.amber, fontWeight: 600 }}>
                              {elapsed}분 경과
                            </span>
                          )}
                        </div>

                        {/* 경기 시작 button */}
                        {current.status === 'scheduled' && (
                          <button
                            className="cv-start-btn"
                            style={{ marginTop: 18 }}
                            onClick={() => startMatch(current.id)}
                          >
                            <Play size={18} fill="#fff" style={{ flexShrink: 0 }} />
                            경기 시작
                          </button>
                        )}
                      </div>
                    ) : (
                      /* Empty court drop zone */
                      <div style={{
                        flex:           1,
                        display:        'flex',
                        alignItems:     'center',
                        justifyContent: 'center',
                        padding:        '28px 16px',
                        border:         `2px dashed ${isDrop ? C.green : T.border}`,
                        borderRadius:   12,
                        marginTop:      10,
                        fontSize:       15,
                        color:          isDrop ? C.green : T.sub,
                        fontWeight:     isDrop ? 600 : 400,
                        transition:    'all 0.2s',
                        textAlign:     'center',
                      }}>
                        {isDrop ? '여기에 놓아 배정' : '경기 없음'}
                      </div>
                    )}

                    {/* Next match */}
                    {next && (
                      <>
                        <div style={{ height: 1, background: T.border, margin: '16px 0' }} />
                        <div>
                          <div style={{
                            fontSize:      12,
                            fontWeight:    700,
                            letterSpacing: 1.5,
                            color:         T.sub,
                            textTransform: 'uppercase',
                            marginBottom:  9,
                            display:      'flex',
                            alignItems:   'center',
                            gap:           4,
                          }}>
                            <ChevronRight size={13} />
                            다음 경기
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: 700, color: T.text, wordBreak: 'break-word' }}>
                              {next.team_a_name}
                            </span>
                            <span style={{ fontSize: 14, color: T.sub, flexShrink: 0 }}>vs</span>
                            <span style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: 700, color: T.text, wordBreak: 'break-word' }}>
                              {next.team_b_name}
                            </span>
                          </div>
                          <div style={{
                            textAlign:      'center',
                            fontSize:       13,
                            color:          T.sub,
                            marginTop:      6,
                            display:       'flex',
                            alignItems:    'center',
                            justifyContent: 'center',
                            gap:            6,
                          }}>
                            <Clock size={12} />
                            {fmtTime(next.scheduled_time)} 예정
                            {next.category_name && <span>· {next.category_name}</span>}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ──── Unassigned matches panel ──────────────────── */}
          {unassigned.length > 0 && (
            <section style={{ marginTop: 32 }}>
              <div style={{
                display:      'flex',
                alignItems:   'center',
                flexWrap:     'wrap',
                gap:           10,
                marginBottom:  14,
              }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: T.text }}>
                  다음 경기 배정
                </h2>
                <span style={{
                  background:   `${C.amber}22`,
                  color:         C.amber,
                  border:       `1px solid ${C.amber}44`,
                  borderRadius:  6,
                  padding:      '3px 11px',
                  fontSize:      14,
                  fontWeight:    700,
                }}>
                  {unassigned.length}건 미배정
                </span>
                <span style={{ fontSize: 14, color: T.sub }}>
                  — 코트로 드래그하거나 버튼으로 바로 배정
                </span>
              </div>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {unassigned.map(match => (
                  <div
                    key={match.id}
                    className="cv-uncard"
                    draggable
                    onDragStart={() => onDragStart(match)}
                    onDragEnd={onDragEnd}
                    style={{
                      background:   T.surface,
                      border:       `1px solid ${T.border}`,
                      borderRadius:  12,
                      padding:      '16px 18px',
                      minWidth:      240,
                      maxWidth:      340,
                    }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 5, lineHeight: 1.3 }}>
                      {match.team_a_name}{' '}
                      <span style={{ color: T.sub, fontWeight: 400 }}>vs</span>{' '}
                      {match.team_b_name}
                    </div>
                    <div style={{
                      fontSize:     13,
                      color:        T.sub,
                      marginBottom: 12,
                      display:     'flex',
                      flexWrap:    'wrap',
                      gap:          8,
                      alignItems:  'center',
                    }}>
                      {match.category_name && (
                        <span style={{
                          background:   T.chipBg,
                          color:        T.chipText,
                          borderRadius:  5,
                          padding:      '2px 8px',
                          fontWeight:    600,
                          fontSize:      12,
                        }}>
                          {match.category_name}
                        </span>
                      )}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={12} />
                        {fmtTime(match.scheduled_time)}
                      </span>
                    </div>

                    {/* Quick-assign chips for free courts */}
                    {freeCourts.length > 0 ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {freeCourts.map(([cn]) => (
                          <button
                            key={cn}
                            className="cv-assign-chip"
                            disabled={assigning}
                            onClick={() => assignToCourt(match.id, Number(cn))}
                          >
                            코트 {cn}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: T.sub }}>
                        빈 코트가 없습니다
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>

        {/* ──── Footer ───────────────────────────────────────── */}
        <footer style={{
          padding:        '10px 28px',
          borderTop:      `1px solid ${T.border}`,
          display:        'flex',
          justifyContent: 'space-between',
          alignItems:     'center',
          fontSize:        13,
          color:           T.sub,
          flexShrink:      0,
        }}>
          <span>15초마다 자동 새로고침 · 실시간 연동 중</span>
          {refreshAt && (
            <span>
              마지막 갱신: {refreshAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </footer>
      </div>
    </>
  );
}
