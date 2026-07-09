import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Monitor, Clock, RefreshCw, Maximize, Minimize, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';

/* ══════════════════════════════════════════════════════════════
   체육관 프로젝터용 코트 현황판 (어두운 배경 · 고대비 · 전체화면)
   - 코트별 대형 카드: 현재 경기 팀명 · 실시간 점수 · 서브권 · 경과 시간
   - 다음 경기 대기열
   - match_events 실시간 반영 + 15초 폴링 폴백
══════════════════════════════════════════════════════════════ */

const REFRESH_MS = 15_000;
const DONE_STATUSES = ['completed', 'forfeited', 'bye'];

/* 색상 토큰 (어두운 배경 고정) */
const T = {
  bg:      '#0a1120',
  surface: '#111d33',
  border:  '#22385f',
  text:    '#f2f6fc',
  sub:     '#8aa5c4',
  green:   '#22c55e',
  amber:   '#f59e0b',
  red:     '#C60C30',
  blue:    '#003478',
  serve:   '#facc15',
};

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
    50%     { box-shadow: 0 0 0 12px rgba(34,197,94,0);  }
  }
  .cv-icon-btn {
    background: rgba(255,255,255,0.12);
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 8px;
    padding: 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
    flex-shrink: 0;
  }
  .cv-icon-btn:hover { background: rgba(255,255,255,0.22); }
  .cv-icon-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
`;

/* ── 도우미 ────────────────────────────────────────────── */
function teamLabel(entry) {
  if (!entry) return '미정';
  if (entry.team_name) return entry.team_name;
  const names = [entry.player1?.name, entry.player2?.name].filter(Boolean);
  return names.length > 0 ? names.join(' · ') : '미정';
}

const fmtTime = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '–';

const elapsedMin = (iso) =>
  iso ? Math.max(0, Math.floor((Date.now() - new Date(iso)) / 60_000)) : null;

/* 세트(게임) 점수 요약 "21-18, 19-21" */
function setSummary(scores) {
  if (!scores || scores.length === 0) return null;
  return [...scores]
    .sort((a, b) => a.set_number - b.set_number)
    .map((s) => `${s.team1_score}-${s.team2_score}`)
    .join(', ');
}

/* ── 코트 카드 ─────────────────────────────────────────── */
function CourtCard({ courtNo, current, next, catNameById }) {
  const isLive = current?.status === 'in_progress';
  const status = !current ? 'empty' : isLive ? 'live' : 'waiting';
  const meta = {
    live:    { label: '경기 중',  color: T.green },
    waiting: { label: '경기 준비', color: T.amber },
    empty:   { label: '비어있음', color: T.sub },
  }[status];

  const s1 = current?.live_score_t1 ?? 0;
  const s2 = current?.live_score_t2 ?? 0;
  const server = current?.live_server_team;
  const elapsed = isLive ? elapsedMin(current?.actual_start) : null;
  const summary = current ? setSummary(current.match_scores) : null;

  return (
    <div
      style={{
        background: T.surface,
        border: isLive ? `2px solid ${T.green}` : `1px solid ${T.border}`,
        borderRadius: 18,
        padding: '22px 26px',
        display: 'flex',
        flexDirection: 'column',
        animation: isLive ? 'cv-glow 3s ease-in-out infinite' : 'none',
      }}
    >
      {/* 코트 번호 + 상태 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2.5, color: T.sub, textTransform: 'uppercase' }}>
            Court
          </div>
          <div style={{
            fontSize: 72, fontWeight: 900, lineHeight: 1, color: meta.color,
            fontVariantNumeric: 'tabular-nums',
            textShadow: isLive ? `0 0 44px ${T.green}55` : 'none',
          }}>
            {courtNo}
          </div>
        </div>
        <div style={{
          marginTop: 8,
          background: `${meta.color}1a`,
          border: `1px solid ${meta.color}55`,
          color: meta.color,
          borderRadius: 8,
          padding: '7px 14px',
          fontSize: 15,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          whiteSpace: 'nowrap',
        }}>
          {isLive && (
            <span style={{
              width: 9, height: 9, background: T.green, borderRadius: '50%',
              display: 'inline-block', animation: 'cv-pulse 1.5s ease-in-out infinite',
            }} />
          )}
          {meta.label}
          {isLive && current?.live_game_no && (
            <span style={{ fontWeight: 400, opacity: 0.85 }}>· {current.live_game_no}게임</span>
          )}
        </div>
      </div>

      {/* 현재 경기 */}
      {current ? (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0' }}>
            {/* 팀 1 */}
            <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: T.text, lineHeight: 1.25, wordBreak: 'keep-all' }}>
                {teamLabel(current.team1_entry)}
              </div>
              {server === 1 && (
                <div style={{ marginTop: 5, fontSize: 13, fontWeight: 700, color: T.serve }}>
                  ● 서브
                </div>
              )}
            </div>

            {/* 점수 */}
            <div style={{ textAlign: 'center', minWidth: 130, flexShrink: 0 }}>
              {isLive ? (
                <div style={{
                  fontSize: 58, fontWeight: 900, lineHeight: 1, letterSpacing: 2,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  <span style={{ color: s1 >= s2 ? T.green : T.sub }}>{s1}</span>
                  <span style={{ color: T.border, margin: '0 5px', fontSize: 38 }}>:</span>
                  <span style={{ color: s2 >= s1 ? T.green : T.sub }}>{s2}</span>
                </div>
              ) : (
                <span style={{ fontSize: 22, color: T.sub, fontWeight: 300 }}>vs</span>
              )}
              {summary && (
                <div style={{ marginTop: 8, fontSize: 14, color: T.sub, fontVariantNumeric: 'tabular-nums' }}>
                  {summary}
                </div>
              )}
            </div>

            {/* 팀 2 */}
            <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: T.text, lineHeight: 1.25, wordBreak: 'keep-all' }}>
                {teamLabel(current.team2_entry)}
              </div>
              {server === 2 && (
                <div style={{ marginTop: 5, fontSize: 13, fontWeight: 700, color: T.serve }}>
                  ● 서브
                </div>
              )}
            </div>
          </div>

          {/* 메타 정보 */}
          <div style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            flexWrap: 'wrap', gap: 12, fontSize: 14, color: T.sub,
          }}>
            {catNameById[current.category_id] && (
              <span style={{
                background: 'rgba(0,52,120,0.45)', color: '#7baef5',
                borderRadius: 6, padding: '3px 10px', fontWeight: 600, fontSize: 13,
              }}>
                {catNameById[current.category_id]}
              </span>
            )}
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Clock size={14} />
              {isLive
                ? `${fmtTime(current.actual_start)} 시작`
                : `${fmtTime(current.scheduled_time)} 예정`}
            </span>
            {elapsed !== null && (
              <span style={{ color: T.amber, fontWeight: 700 }}>{elapsed}분 경과</span>
            )}
          </div>
        </div>
      ) : (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '30px 16px', border: `2px dashed ${T.border}`, borderRadius: 12,
          marginTop: 12, fontSize: 17, color: T.sub,
        }}>
          예정된 경기 없음
        </div>
      )}

      {/* 다음 경기 */}
      {next && (
        <>
          <div style={{ height: 1, background: T.border, margin: '16px 0 12px' }} />
          <div>
            <div style={{
              fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: T.sub,
              textTransform: 'uppercase', marginBottom: 7,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <ChevronRight size={13} />
              다음 경기
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: 700, color: T.text, wordBreak: 'keep-all' }}>
                {teamLabel(next.team1_entry)}
              </span>
              <span style={{ fontSize: 14, color: T.sub, flexShrink: 0 }}>vs</span>
              <span style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: 700, color: T.text, wordBreak: 'keep-all' }}>
                {teamLabel(next.team2_entry)}
              </span>
            </div>
            <div style={{
              textAlign: 'center', fontSize: 13, color: T.sub, marginTop: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Clock size={12} />
              {fmtTime(next.scheduled_time)} 예정
              {catNameById[next.category_id] && <span>· {catNameById[next.category_id]}</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── 메인 컴포넌트 ─────────────────────────────────────── */
export default function CourtView() {
  const { id: tournamentId } = useParams();

  const [tournament, setTournament] = useState(null);
  const [categories, setCategories] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshAt, setRefreshAt] = useState(null);
  const [isFull, setIsFull] = useState(false);
  const [, setTick] = useState(0); // 경과 시간 갱신용

  const rootRef = useRef(null);
  const catIdsRef = useRef(new Set());
  const matchIdsRef = useRef(new Set());

  /* ── 조회: matches에 tournament_id가 없으므로 category 경유 ── */
  const fetchData = useCallback(async () => {
    if (!tournamentId) return;
    try {
      const [{ data: trn }, { data: cats }] = await Promise.all([
        supabase
          .from('tournaments')
          .select('id, title, court_count, date, status')
          .eq('id', tournamentId)
          .single(),
        supabase
          .from('tournament_categories')
          .select('id, sport_type')
          .eq('tournament_id', tournamentId),
      ]);

      if (trn) setTournament(trn);
      const catList = cats ?? [];
      setCategories(catList);
      const catIds = catList.map((c) => c.id);
      catIdsRef.current = new Set(catIds);

      if (catIds.length === 0) {
        setMatches([]);
        setLoading(false);
        setRefreshAt(new Date());
        return;
      }

      const { data: mts, error: mtsErr } = await supabase
        .from('tournament_matches')
        .select(`
          id, category_id, status, court_number, scheduled_time, actual_start,
          match_number, winner_entry_id, team1_entry_id, team2_entry_id,
          live_game_no, live_score_t1, live_score_t2, live_server_team,
          match_scores(set_number, team1_score, team2_score),
          team1_entry:tournament_entries!team1_entry_id(
            id, team_name,
            player1:profiles!player1_id(name),
            player2:profiles!player2_id(name)
          ),
          team2_entry:tournament_entries!team2_entry_id(
            id, team_name,
            player1:profiles!player1_id(name),
            player2:profiles!player2_id(name)
          )
        `)
        .in('category_id', catIds)
        .order('scheduled_time', { ascending: true, nullsFirst: false });
      if (mtsErr) throw mtsErr;

      setMatches(mts ?? []);
      matchIdsRef.current = new Set((mts ?? []).map((m) => m.id));
      setRefreshAt(new Date());
    } catch (err) {
      console.error('[CourtView] load error', err);
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  /* ── 폴링 폴백 ── */
  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchData]);

  /* ── 경과 시간 30초 틱 ── */
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  /* ── 실시간: match_events 포인트 단위 + matches 상태 변화 ── */
  useEffect(() => {
    if (!tournamentId) return;
    const channel = supabase
      .channel(`court-view-${tournamentId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'match_events' },
        (payload) => {
          const ev = payload.new;
          if (!ev || !matchIdsRef.current.has(ev.match_id)) return;
          if (ev.event_type !== 'point' && ev.event_type !== 'undo') return;
          setMatches((prev) =>
            prev.map((m) =>
              m.id === ev.match_id
                ? {
                    ...m,
                    live_game_no: ev.game_no ?? m.live_game_no,
                    live_score_t1: ev.score_t1,
                    live_score_t2: ev.score_t2,
                    live_server_team: ev.server_team ?? m.live_server_team,
                  }
                : m
            )
          );
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournament_matches' },
        (payload) => {
          const row = payload.new ?? payload.old;
          if (!row || !catIdsRef.current.has(row.category_id)) return;
          if (payload.eventType === 'UPDATE' && matchIdsRef.current.has(row.id)) {
            let statusChanged = false;
            setMatches((prev) =>
              prev.map((m) => {
                if (m.id !== row.id) return m;
                if (m.status !== row.status) statusChanged = true;
                return { ...m, ...row, team1_entry: m.team1_entry, team2_entry: m.team2_entry, match_scores: m.match_scores };
              })
            );
            if (statusChanged) fetchData();
          } else {
            fetchData();
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tournamentId, fetchData]);

  /* ── 전체화면 ── */
  useEffect(() => {
    const onFs = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      rootRef.current?.requestFullscreen?.();
    }
  }

  /* ── 파생값 ── */
  const catNameById = {};
  for (const c of categories) catNameById[c.id] = c.sport_type;

  const playable = matches.filter((m) => !DONE_STATUSES.includes(m.status));
  const doneCount = matches.filter((m) => DONE_STATUSES.includes(m.status)).length;
  // bye 는 실제 코트에서 치르지 않으므로 총 경기 수에서 제외
  const totalCount = matches.filter((m) => m.status !== 'bye').length;
  const realDone = matches.filter((m) => m.status === 'completed' || m.status === 'forfeited').length;
  const pct = totalCount ? Math.round((realDone / totalCount) * 100) : 0;

  // 코트 목록: 대회 court_count 기준 + 실제로 배정된 코트 번호 합집합
  const courtCount = tournament?.court_count ?? 4;
  const courtNums = new Set(Array.from({ length: courtCount }, (_, i) => i + 1));
  for (const m of playable) {
    if (m.court_number != null) courtNums.add(m.court_number);
  }
  const courtList = [...courtNums].sort((a, b) => a - b);

  // 코트별 현재 경기(진행 중 우선, 없으면 첫 예정) + 다음 경기
  const courtMap = {};
  for (const cn of courtNums) {
    const onCourt = playable
      .filter((m) => m.court_number === cn)
      .sort((a, b) => new Date(a.scheduled_time ?? 0) - new Date(b.scheduled_time ?? 0));
    const live = onCourt.find((m) => m.status === 'in_progress');
    const sched = onCourt.filter((m) => m.status === 'scheduled');
    courtMap[cn] = {
      current: live ?? sched[0] ?? null,
      next: live ? sched[0] ?? null : sched[1] ?? null,
    };
  }

  // 대기열: 아직 시작 안 한 경기 (코트 카드에 이미 표시된 것 제외)
  const shownIds = new Set(
    Object.values(courtMap).flatMap(({ current, next }) => [current?.id, next?.id]).filter(Boolean)
  );
  const queue = playable
    .filter((m) => m.status === 'scheduled' && !shownIds.has(m.id))
    .sort((a, b) => new Date(a.scheduled_time ?? 0) - new Date(b.scheduled_time ?? 0))
    .slice(0, 12);

  const gridCols = courtList.length <= 2 ? courtList.length : courtList.length <= 4 ? 2 : courtList.length <= 6 ? 3 : 4;
  const liveCount = matches.filter((m) => m.status === 'in_progress').length;

  /* ── 로딩 ── */
  if (loading) {
    return (
      <div
        className="cv-root"
        style={{ background: T.bg, alignItems: 'center', justifyContent: 'center', gap: 20 }}
      >
        <style>{STYLES}</style>
        <RefreshCw size={48} color={T.sub} style={{ animation: 'cv-spin 1s linear infinite' }} />
        <p style={{ color: T.sub, fontSize: 24, margin: 0 }}>코트 현황을 불러오는 중...</p>
      </div>
    );
  }

  /* ── 렌더 ── */
  return (
    <>
      <style>{STYLES}</style>
      <div className="cv-root" ref={rootRef} style={{ background: T.bg, color: T.text }}>

        {/* 헤더 */}
        <header style={{
          background: '#091020',
          borderBottom: `3px solid ${T.blue}`,
          padding: '16px 30px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
            <div style={{
              background: 'rgba(255,255,255,0.1)', borderRadius: 12,
              padding: '10px 12px', display: 'flex', flexShrink: 0,
            }}>
              <Monitor size={30} color="#fff" />
            </div>
            <div style={{ minWidth: 0 }}>
              <h1 style={{
                margin: 0, fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1.1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {tournament?.title ?? '대회 코트 현황'}
              </h1>
              <p style={{ margin: '4px 0 0', fontSize: 15, color: 'rgba(255,255,255,0.5)' }}>
                실시간 코트 현황판
                {liveCount > 0 && (
                  <span style={{ color: T.green, fontWeight: 700 }}> · {liveCount}개 코트 경기 중</span>
                )}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 26, flexShrink: 0 }}>
            {/* 진행률 */}
            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontSize: 34, fontWeight: 900, color: '#fff', lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {realDone}
                <span style={{ fontSize: 19, fontWeight: 400, opacity: 0.5 }}> / {totalCount}</span>
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>경기 완료</div>
              <div style={{
                height: 5, width: 120, background: 'rgba(255,255,255,0.15)',
                borderRadius: 3, marginTop: 6, marginLeft: 'auto', overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', background: T.green, borderRadius: 3,
                  width: `${pct}%`, transition: 'width 0.6s ease',
                }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={fetchData} className="cv-icon-btn" title="새로고침">
                <RefreshCw size={20} color="#fff" />
              </button>
              <button onClick={toggleFullscreen} className="cv-icon-btn" title={isFull ? '전체화면 나가기' : '전체화면'}>
                {isFull ? <Minimize size={20} color="#fff" /> : <Maximize size={20} color="#fff" />}
              </button>
            </div>
          </div>
        </header>

        {/* 본문 */}
        <main style={{ flex: 1, padding: '24px 28px', overflowY: 'auto' }}>
          {matches.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '80px 0', color: T.sub, fontSize: 20 }}>
              아직 편성된 경기가 없습니다
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
              gap: 20,
            }}>
              {courtList.map((cn) => (
                <CourtCard
                  key={cn}
                  courtNo={cn}
                  current={courtMap[cn]?.current}
                  next={courtMap[cn]?.next}
                  catNameById={catNameById}
                />
              ))}
            </div>
          )}

          {/* 대기열 */}
          {queue.length > 0 && (
            <section style={{ marginTop: 32 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: T.text }}>
                  다음 경기 대기열
                </h2>
                <span style={{
                  background: `${T.amber}22`, color: T.amber,
                  border: `1px solid ${T.amber}44`, borderRadius: 6,
                  padding: '3px 11px', fontSize: 14, fontWeight: 700,
                }}>
                  {queue.length}경기 대기
                </span>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {queue.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      background: T.surface,
                      border: `1px solid ${T.border}`,
                      borderRadius: 12,
                      padding: '14px 18px',
                      minWidth: 240,
                      maxWidth: 340,
                    }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 6, lineHeight: 1.35 }}>
                      {teamLabel(m.team1_entry)}{' '}
                      <span style={{ color: T.sub, fontWeight: 400 }}>vs</span>{' '}
                      {teamLabel(m.team2_entry)}
                    </div>
                    <div style={{
                      fontSize: 13, color: T.sub,
                      display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
                    }}>
                      {catNameById[m.category_id] && (
                        <span style={{
                          background: 'rgba(0,52,120,0.45)', color: '#7baef5',
                          borderRadius: 5, padding: '2px 8px', fontWeight: 600, fontSize: 12,
                        }}>
                          {catNameById[m.category_id]}
                        </span>
                      )}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={12} />
                        {fmtTime(m.scheduled_time)}
                      </span>
                      <span>
                        {m.court_number != null ? `코트 ${m.court_number}` : '코트 미배정'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>

        {/* 푸터 */}
        <footer style={{
          padding: '10px 28px',
          borderTop: `1px solid ${T.border}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 13,
          color: T.sub,
          flexShrink: 0,
        }}>
          <span>실시간 연동 중 · 15초마다 자동 새로고침</span>
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
