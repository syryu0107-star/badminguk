import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Clock, MapPin, Wifi, Trophy, RefreshCw, ListOrdered } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { calculatePoolStandings } from '../../lib/tournament';

/* ── 상수 ──────────────────────────────────────────────── */
const DONE_STATUSES = ['completed', 'forfeited', 'bye'];

const CERT_BADGE = {
  none: { label: '비공인', bg: '#6B7280' },
  c: { label: '공인 C', bg: '#2563eb' },
  b: { label: '공인 B', bg: '#7c3aed' },
  a: { label: '공인 A', bg: '#C60C30' },
};

const FORMAT_LABEL = {
  round_robin: '리그전',
  single_elim: '토너먼트',
  pool_knockout: '조별예선+본선',
  pool_only: '조별리그',
};

/* ── 도우미 ────────────────────────────────────────────── */
// 팀 표시 이름: 팀명 → 선수 이름 → '미정'
function teamLabel(entry) {
  if (!entry) return '미정';
  if (entry.team_name) return entry.team_name;
  const names = [entry.player1?.name, entry.player2?.name].filter(Boolean);
  return names.length > 0 ? names.join(' · ') : '미정';
}

// match_scores rows → "21-18, 19-21" 문자열
function setSummary(scores) {
  if (!scores || scores.length === 0) return null;
  return [...scores]
    .sort((a, b) => a.set_number - b.set_number)
    .map((s) => `${s.team1_score}-${s.team2_score}`)
    .join(', ');
}

// 녹아웃 라운드 이름 (round_number 1=1라운드 … maxRound=결승)
function knockoutRoundLabel(roundNumber, maxRound) {
  if (!roundNumber || !maxRound) return '본선';
  const teams = Math.pow(2, maxRound - roundNumber + 1);
  if (teams <= 2) return '결승';
  if (teams === 4) return '준결승';
  return `${teams}강`;
}

function fmtClock(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

/* ── 작은 컴포넌트 ─────────────────────────────────────── */
function CertBadge({ level }) {
  const def = CERT_BADGE[level];
  if (!def || level === 'none') return null;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold text-white"
      style={{ backgroundColor: def.bg }}
    >
      {def.label}
    </span>
  );
}

function MetaChips({ match, poolName, roundName }) {
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
      {match.court_number != null && (
        <span className="font-bold text-gray-600">코트 {match.court_number}</span>
      )}
      {poolName && <span>{poolName}</span>}
      {roundName && <span>{roundName}</span>}
      {match.scheduled_time && (
        <span className="flex items-center gap-1">
          <Clock size={11} />
          {fmtClock(match.scheduled_time)}
        </span>
      )}
    </div>
  );
}

/* 진행 중 경기 카드: 포인트 단위 실시간 점수 */
function LiveMatchCard({ match, poolName, roundName }) {
  const t1 = teamLabel(match.team1_entry);
  const t2 = teamLabel(match.team2_entry);
  const s1 = match.live_score_t1 ?? 0;
  const s2 = match.live_score_t2 ?? 0;
  const server = match.live_server_team;
  const summary = setSummary(match.match_scores);

  return (
    <div className="rounded-2xl border-2 border-red-500 bg-white shadow-md overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 text-white" style={{ backgroundColor: '#C60C30' }}>
        <span className="text-xs font-extrabold tracking-widest">
          {match.court_number != null ? `코트 ${match.court_number}` : '경기 중'}
        </span>
        <span className="flex items-center gap-1.5 text-xs font-extrabold animate-pulse">
          <span className="w-2 h-2 rounded-full bg-white inline-block" />
          진행 중 · {match.live_game_no ?? 1}게임
        </span>
      </div>

      <div className="px-4 py-4">
        <div className="flex items-center gap-3">
          {/* 팀 1 */}
          <div className="flex-1 text-center min-w-0">
            <div className="font-bold text-gray-900 leading-tight break-keep">
              {t1}
              {server === 1 && (
                <span className="ml-1 inline-block align-middle w-2 h-2 rounded-full bg-yellow-400" title="서브" />
              )}
            </div>
          </div>

          {/* 현재 게임 점수 */}
          <div className="shrink-0 text-center">
            <div className="text-4xl font-black tabular-nums leading-none">
              <span className={s1 >= s2 ? 'text-red-600' : 'text-gray-400'}>{s1}</span>
              <span className="text-gray-300 mx-1.5 text-2xl">:</span>
              <span className={s2 >= s1 ? 'text-red-600' : 'text-gray-400'}>{s2}</span>
            </div>
          </div>

          {/* 팀 2 */}
          <div className="flex-1 text-center min-w-0">
            <div className="font-bold text-gray-900 leading-tight break-keep">
              {t2}
              {server === 2 && (
                <span className="ml-1 inline-block align-middle w-2 h-2 rounded-full bg-yellow-400" title="서브" />
              )}
            </div>
          </div>
        </div>

        {summary && (
          <p className="text-center text-xs text-gray-500 mt-2 font-mono">지난 게임 {summary}</p>
        )}
        <div className="flex justify-center mt-2">
          <MetaChips match={match} poolName={poolName} roundName={roundName} />
        </div>
      </div>
    </div>
  );
}

/* 예정 경기 행 */
function ScheduledRow({ match, poolName, roundName }) {
  return (
    <div className="rounded-xl border border-blue-100 bg-white px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-right font-semibold text-gray-800 text-sm break-keep">
          {teamLabel(match.team1_entry)}
        </span>
        <span className="text-xs text-gray-400 font-medium shrink-0">vs</span>
        <span className="flex-1 text-left font-semibold text-gray-800 text-sm break-keep">
          {teamLabel(match.team2_entry)}
        </span>
      </div>
      <div className="flex justify-center mt-1.5">
        <MetaChips match={match} poolName={poolName} roundName={roundName} />
      </div>
    </div>
  );
}

/* 완료 경기 행 */
function DoneRow({ match, poolName, roundName }) {
  const isBye = match.status === 'bye';
  const isForfeit = match.status === 'forfeited';
  const w1 = match.winner_entry_id && match.winner_entry_id === match.team1_entry_id;
  const w2 = match.winner_entry_id && match.winner_entry_id === match.team2_entry_id;
  const summary = setSummary(match.match_scores);

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="flex items-center gap-2">
        <span
          className={[
            'flex-1 text-right text-sm break-keep',
            w1 ? 'font-extrabold text-green-700' : 'font-medium text-gray-500',
          ].join(' ')}
        >
          {w1 && <Trophy size={13} className="inline mr-1 mb-0.5 text-green-600" />}
          {teamLabel(match.team1_entry)}
        </span>
        <span className="shrink-0 text-xs font-mono text-gray-600 px-1">
          {isBye ? '부전승' : summary ?? `${match.games_won_team1 ?? 0}:${match.games_won_team2 ?? 0}`}
        </span>
        <span
          className={[
            'flex-1 text-left text-sm break-keep',
            w2 ? 'font-extrabold text-green-700' : 'font-medium text-gray-500',
          ].join(' ')}
        >
          {teamLabel(match.team2_entry)}
          {w2 && <Trophy size={13} className="inline ml-1 mb-0.5 text-green-600" />}
        </span>
      </div>
      <div className="flex justify-center items-center gap-2 mt-1.5">
        <MetaChips match={match} poolName={poolName} roundName={roundName} />
        {isForfeit && (
          <span className="text-xs text-red-500 font-semibold">기권</span>
        )}
      </div>
    </div>
  );
}

/* 조별 순위표 */
function PoolStandingsTable({ pool, standings }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-2 text-sm font-bold text-white" style={{ backgroundColor: '#003478' }}>
        {pool.pool_name}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 border-b border-gray-100">
              <th className="py-1.5 px-3 text-left font-semibold w-8">순위</th>
              <th className="py-1.5 px-2 text-left font-semibold">팀</th>
              <th className="py-1.5 px-2 text-center font-semibold">승-패</th>
              <th className="py-1.5 px-3 text-center font-semibold">득실</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row) => (
              <tr key={row.entryId} className="border-b border-gray-50 last:border-0">
                <td className="py-2 px-3 font-bold text-gray-700">{row.rank}</td>
                <td className="py-2 px-2 font-semibold text-gray-900 break-keep">{row.label}</td>
                <td className="py-2 px-2 text-center tabular-nums text-gray-700">
                  {row.wins}-{row.losses}
                </td>
                <td className={[
                  'py-2 px-3 text-center tabular-nums font-semibold',
                  row.pointDiff > 0 ? 'text-green-600' : row.pointDiff < 0 ? 'text-red-500' : 'text-gray-400',
                ].join(' ')}>
                  {row.pointDiff > 0 ? `+${row.pointDiff}` : row.pointDiff}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── 메인 컴포넌트 ─────────────────────────────────────── */
export default function LiveScore() {
  const { id } = useParams();

  const [tournament, setTournament] = useState(null);
  const [categories, setCategories] = useState([]);
  const [matches, setMatches] = useState([]);
  const [pools, setPools] = useState([]);
  const [activeCatId, setActiveCatId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  // 실시간 콜백에서 최신 목록을 참조하기 위한 ref
  const catIdsRef = useRef(new Set());
  const matchIdsRef = useRef(new Set());

  const loadData = useCallback(async () => {
    try {
      // 1) 대회 (이름 컬럼은 title, 날짜는 date)
      const { data: trn, error: trnErr } = await supabase
        .from('tournaments')
        .select('id, title, venue, date, start_time, cert_level, status')
        .eq('id', id)
        .single();
      if (trnErr) throw trnErr;
      setTournament(trn);

      // 2) 종목 (표시명은 sport_type — name 컬럼 없음)
      const { data: cats, error: catsErr } = await supabase
        .from('tournament_categories')
        .select('id, sport_type, tournament_format, games_per_match, points_per_game, tiebreaker_order')
        .eq('tournament_id', id)
        .order('sport_type');
      if (catsErr) throw catsErr;
      const catList = cats ?? [];
      setCategories(catList);
      setActiveCatId((prev) => prev ?? catList[0]?.id ?? null);

      const catIds = catList.map((c) => c.id);
      catIdsRef.current = new Set(catIds);

      if (catIds.length === 0) {
        setMatches([]);
        setPools([]);
        setLastRefresh(new Date());
        return;
      }

      // 3) 경기: matches에는 tournament_id가 없으므로 category_id 목록으로 조회
      const { data: mts, error: mtsErr } = await supabase
        .from('tournament_matches')
        .select(`
          id, category_id, pool_id, match_phase, round_type, round_number, bracket_pos,
          match_number, court_number, scheduled_time, actual_start, status,
          winner_entry_id, team1_entry_id, team2_entry_id,
          games_won_team1, games_won_team2, result_type,
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

      // 4) 조(풀) + 조 소속 팀 (조별 순위 계산용)
      const { data: pls, error: plsErr } = await supabase
        .from('tournament_pools')
        .select(`
          id, category_id, pool_name, pool_index,
          tournament_pool_entries(
            entry_id,
            entry:tournament_entries!entry_id(
              id, team_name,
              player1:profiles!player1_id(name),
              player2:profiles!player2_id(name)
            )
          )
        `)
        .in('category_id', catIds)
        .order('pool_index');
      if (plsErr) throw plsErr;
      setPools(pls ?? []);

      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      console.error('[LiveScore] load error', err);
      setError(err.message ?? '데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // 첫 로드
  useEffect(() => {
    loadData();
  }, [loadData]);

  // 30초 폴링 폴백 — 백그라운드 탭에서는 중단, 복귀 시 즉시 갱신
  useEffect(() => {
    let timer = null;
    const start = () => { if (!timer) timer = setInterval(loadData, 30_000); };
    const stop = () => { clearInterval(timer); timer = null; };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { loadData(); start(); }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [loadData]);

  // Supabase 실시간 구독
  // - match_events INSERT: 포인트 단위 → 해당 경기 라이브 점수만 로컬 갱신 (재조회 없음)
  // - tournament_matches: 상태 변화·신규 경기는 재조회, 라이브 캐시 갱신은 로컬 병합
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`live-score-${id}`)
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
                // 조인된 팀 정보는 유지하고 스칼라 컬럼만 병합
                return { ...m, ...row, team1_entry: m.team1_entry, team2_entry: m.team2_entry, match_scores: m.match_scores };
              })
            );
            // 완료 등 상태 전이는 세트 점수·순위까지 다시 조회
            if (statusChanged) loadData();
          } else {
            loadData();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, loadData]);

  /* ── 파생 값 ──────────────────────────────────────────── */
  const activeCat = categories.find((c) => c.id === activeCatId);
  const catMatches = matches.filter((m) => m.category_id === activeCatId);

  const liveMatches = catMatches
    .filter((m) => m.status === 'in_progress')
    .sort((a, b) => (a.court_number ?? 99) - (b.court_number ?? 99));
  const scheduledMatches = catMatches.filter((m) => m.status === 'scheduled');
  const doneMatches = [...catMatches.filter((m) => DONE_STATUSES.includes(m.status))].reverse();

  const totalLive = matches.filter((m) => m.status === 'in_progress').length;

  // 녹아웃 라운드 이름 계산용: 종목 내 최대 round_number
  const maxRound = Math.max(
    0,
    ...catMatches.filter((m) => m.match_phase === 'knockout').map((m) => m.round_number ?? 0)
  );
  const poolNameById = {};
  for (const p of pools) poolNameById[p.id] = p.pool_name;

  const matchLabels = (m) => ({
    poolName: m.pool_id ? poolNameById[m.pool_id] : null,
    roundName: m.match_phase === 'knockout' ? knockoutRoundLabel(m.round_number, maxRound) : null,
  });

  // 활성 종목의 조별 순위
  const catPools = pools.filter((p) => p.category_id === activeCatId);
  const poolStandings = catPools.map((pool) => {
    const poolEntries = (pool.tournament_pool_entries ?? []).map((pe) => ({
      entryId: pe.entry_id,
      label: teamLabel(pe.entry),
    }));
    const poolMatches = catMatches
      .filter((m) => m.pool_id === pool.id && (m.status === 'completed' || m.status === 'forfeited'))
      .map((m) => ({
        team1_entry_id: m.team1_entry_id,
        team2_entry_id: m.team2_entry_id,
        winner_entry_id: m.winner_entry_id,
        scores: [...(m.match_scores ?? [])]
          .sort((a, b) => a.set_number - b.set_number)
          .map((s) => [s.team1_score, s.team2_score]),
      }));
    return { pool, standings: calculatePoolStandings(poolEntries, poolMatches, activeCat?.tiebreaker_order) };
  });

  /* ── 렌더 ─────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-4">
        <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: '#C60C30', borderTopColor: 'transparent' }} />
        <p className="text-gray-500 text-sm">경기 정보를 불러오는 중...</p>
      </div>
    );
  }

  if (error || !tournament) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-3 px-4">
        <Trophy size={40} className="text-gray-300" />
        <p className="text-gray-700 font-semibold">대회를 찾을 수 없습니다.</p>
        <p className="text-gray-400 text-sm text-center">{error ?? '올바른 링크인지 확인해주세요.'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* 헤더 */}
      <header
        className="sticky top-0 z-20 shadow-md"
        style={{ background: 'linear-gradient(135deg, #003478 0%, #C60C30 100%)' }}
      >
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {totalLive > 0 ? (
                  <span className="flex items-center gap-1.5 bg-red-600 text-white text-xs font-extrabold px-2.5 py-1 rounded-full animate-pulse shadow">
                    <Wifi size={12} />
                    LIVE {totalLive}경기
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 bg-white/20 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                    <Wifi size={12} />
                    LIVE
                  </span>
                )}
                <CertBadge level={tournament.cert_level} />
              </div>
              <h1 className="text-white font-extrabold text-xl sm:text-2xl leading-tight truncate">
                {tournament.title}
              </h1>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {tournament.date && (
                  <span className="flex items-center gap-1 text-white/80 text-xs">
                    <Clock size={12} />
                    {new Date(`${tournament.date}T00:00:00`).toLocaleDateString('ko-KR', {
                      year: 'numeric', month: 'long', day: 'numeric',
                    })}
                  </span>
                )}
                {tournament.venue && (
                  <span className="flex items-center gap-1 text-white/80 text-xs">
                    <MapPin size={12} />
                    {tournament.venue}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={loadData}
              className="flex-shrink-0 bg-white/20 hover:bg-white/30 active:scale-95 transition text-white rounded-full p-2"
              title="새로고침"
            >
              <RefreshCw size={16} />
            </button>
          </div>

          {lastRefresh && (
            <p className="text-white/50 text-xs mt-2">
              갱신: {lastRefresh.toLocaleTimeString('ko-KR')} · 실시간 + 30초 자동 갱신
            </p>
          )}
        </div>

        {/* 종목 탭 */}
        {categories.length > 0 && (
          <div className="border-t border-white/20">
            <div className="max-w-6xl mx-auto px-4">
              <div className="flex overflow-x-auto gap-1 py-2">
                {categories.map((cat) => {
                  const catLive = matches.filter(
                    (m) => m.category_id === cat.id && m.status === 'in_progress'
                  ).length;
                  const isActive = cat.id === activeCatId;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCatId(cat.id)}
                      className={[
                        'flex-shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold transition-all whitespace-nowrap',
                        isActive
                          ? 'bg-white text-blue-800 shadow'
                          : 'text-white/80 hover:text-white hover:bg-white/20',
                      ].join(' ')}
                    >
                      {cat.sport_type}
                      {catLive > 0 && (
                        <span className="bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                          {catLive}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* 본문 */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-5 space-y-6">
        {categories.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Trophy size={48} className="mx-auto mb-3 opacity-30" />
            <p className="font-semibold">등록된 종목이 없습니다.</p>
          </div>
        ) : !activeCat ? null : (
          <>
            {activeCat.tournament_format && (
              <p className="text-xs text-gray-400 -mb-3">
                {FORMAT_LABEL[activeCat.tournament_format] ?? activeCat.tournament_format}
                {' · '}{activeCat.games_per_match ?? 3}게임 {activeCat.points_per_game ?? 21}점제
              </p>
            )}

            {/* 진행 중 */}
            {liveMatches.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-red-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />
                  진행 중 ({liveMatches.length})
                </h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  {liveMatches.map((m) => (
                    <LiveMatchCard key={m.id} match={m} {...matchLabels(m)} />
                  ))}
                </div>
              </section>
            )}

            {/* 예정 */}
            {scheduledMatches.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-blue-700 uppercase tracking-widest mb-2">
                  예정 경기 ({scheduledMatches.length})
                </h3>
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                  {scheduledMatches.map((m) => (
                    <ScheduledRow key={m.id} match={m} {...matchLabels(m)} />
                  ))}
                </div>
              </section>
            )}

            {/* 완료 */}
            {doneMatches.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                  완료 ({doneMatches.length})
                </h3>
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                  {doneMatches.map((m) => (
                    <DoneRow key={m.id} match={m} {...matchLabels(m)} />
                  ))}
                </div>
              </section>
            )}

            {/* 조별 순위 */}
            {poolStandings.length > 0 && (
              <section>
                <h3 className="text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: '#003478' }}>
                  <ListOrdered size={14} />
                  조별 순위
                </h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  {poolStandings.map(({ pool, standings }) => (
                    <PoolStandingsTable key={pool.id} pool={pool} standings={standings} />
                  ))}
                </div>
              </section>
            )}

            {catMatches.length === 0 && (
              <p className="text-center text-gray-400 py-8 text-sm">아직 등록된 경기가 없습니다.</p>
            )}
          </>
        )}
      </main>

      {/* 푸터 */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-gray-500 text-sm text-center sm:text-left">
            배드민국에서 실시간 경기 결과 · 레이팅(MMR) 관리까지
          </p>
          <a
            href="https://badminguk.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-bold text-sm text-white shadow-md active:scale-95 transition"
            style={{ background: 'linear-gradient(135deg, #003478, #C60C30)' }}
          >
            <Trophy size={15} />
            배드민국으로 MMR 관리하기
          </a>
        </div>
      </footer>
    </div>
  );
}
