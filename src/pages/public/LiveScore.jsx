import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Clock, MapPin, Wifi, Trophy, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { CERT_LEVELS } from '../../lib/mmr';

const STATUS_ORDER = { IN_PROGRESS: 0, SCHEDULED: 1, COMPLETED: 2 };

function CertBadge({ level }) {
  const def = CERT_LEVELS?.[level];
  if (!def) return null;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold"
      style={{ backgroundColor: def.color ?? '#6B7280', color: '#fff' }}
    >
      {def.label ?? level}
    </span>
  );
}

function ScoreDisplay({ scores, winnerId, team1Id, team2Id }) {
  if (!scores || scores.length === 0) return null;
  const sorted = [...scores].sort((a, b) => a.set_number - b.set_number);
  return (
    <div className="flex gap-1.5 flex-wrap justify-center">
      {sorted.map((s) => {
        const t1Wins = s.team1_score > s.team2_score;
        const t2Wins = s.team2_score > s.team1_score;
        return (
          <span
            key={s.set_number}
            className="inline-flex items-center gap-0.5 text-sm font-mono"
          >
            <span className={t1Wins ? 'font-extrabold text-green-600' : 'text-gray-600'}>
              {s.team1_score}
            </span>
            <span className="text-gray-400">:</span>
            <span className={t2Wins ? 'font-extrabold text-green-600' : 'text-gray-600'}>
              {s.team2_score}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function PlayerNames({ entry }) {
  if (!entry) return <span className="text-gray-400">TBD</span>;
  const players = entry.players ?? [];
  if (players.length === 0) return <span className="text-gray-400">미배정</span>;
  return (
    <span>
      {players
        .map((p) => p?.profile?.name ?? p?.profile?.username ?? '?')
        .join(' / ')}
    </span>
  );
}

function MatchCard({ match }) {
  const isLive = match.status === 'IN_PROGRESS';
  const isDone = match.status === 'COMPLETED';

  const winner = isDone ? match.winner_entry_id : null;
  const t1IsWinner = winner && winner === match.team1_entry_id;
  const t2IsWinner = winner && winner === match.team2_entry_id;

  return (
    <div
      className={[
        'rounded-2xl border-2 shadow-sm overflow-hidden transition-all',
        isLive
          ? 'border-red-500 shadow-red-100'
          : isDone
          ? 'border-gray-200 opacity-80'
          : 'border-blue-200',
      ].join(' ')}
    >
      {/* Match header bar */}
      <div
        className={[
          'flex items-center justify-between px-4 py-2 text-sm font-semibold',
          isLive
            ? 'bg-red-600 text-white'
            : isDone
            ? 'bg-gray-100 text-gray-600'
            : 'bg-blue-700 text-white',
        ].join(' ')}
      >
        <div className="flex items-center gap-2">
          {match.court_number && (
            <span className="text-xs font-bold uppercase tracking-widest opacity-90">
              코트 {match.court_number}
            </span>
          )}
          {match.scheduled_time && (
            <span className="flex items-center gap-1 opacity-90 font-normal text-xs">
              <Clock size={12} />
              {new Date(match.scheduled_time).toLocaleTimeString('ko-KR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>
        {isLive && (
          <span className="flex items-center gap-1 animate-pulse font-extrabold tracking-wide">
            <span className="w-2 h-2 rounded-full bg-white inline-block" />
            진행중
          </span>
        )}
        {isDone && <span className="text-xs text-gray-500 font-normal">완료</span>}
        {match.status === 'SCHEDULED' && (
          <span className="text-xs opacity-75 font-normal">예정</span>
        )}
      </div>

      {/* Teams */}
      <div className="px-4 py-3 bg-white">
        {/* Team 1 */}
        <div
          className={[
            'flex items-center justify-between py-1.5',
            t1IsWinner ? 'text-green-700' : 'text-gray-900',
          ].join(' ')}
        >
          <span
            className={[
              'text-base sm:text-lg font-bold leading-tight',
              t1IsWinner ? 'text-green-700' : '',
            ].join(' ')}
          >
            <PlayerNames entry={match.team1_entry} />
          </span>
          {t1IsWinner && <Trophy size={18} className="text-green-600 shrink-0 ml-2" />}
        </div>

        {/* VS + score */}
        <div className="flex items-center justify-center py-1 gap-3">
          <div className="h-px flex-1 bg-gray-200" />
          {isDone || isLive ? (
            <ScoreDisplay
              scores={match.match_scores}
              winnerId={winner}
              team1Id={match.team1_entry_id}
              team2Id={match.team2_entry_id}
            />
          ) : (
            <span className="text-xs text-gray-400 font-medium px-2">VS</span>
          )}
          <div className="h-px flex-1 bg-gray-200" />
        </div>

        {/* Team 2 */}
        <div
          className={[
            'flex items-center justify-between py-1.5',
            t2IsWinner ? 'text-green-700' : 'text-gray-900',
          ].join(' ')}
        >
          <span
            className={[
              'text-base sm:text-lg font-bold leading-tight',
              t2IsWinner ? 'text-green-700' : '',
            ].join(' ')}
          >
            <PlayerNames entry={match.team2_entry} />
          </span>
          {t2IsWinner && <Trophy size={18} className="text-green-600 shrink-0 ml-2" />}
        </div>
      </div>
    </div>
  );
}

function CategorySection({ category, matches }) {
  const sorted = [...matches].sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      new Date(a.scheduled_time ?? 0) - new Date(b.scheduled_time ?? 0)
  );

  const live = sorted.filter((m) => m.status === 'IN_PROGRESS');
  const scheduled = sorted.filter((m) => m.status === 'SCHEDULED');
  const done = sorted.filter((m) => m.status === 'COMPLETED');

  return (
    <div className="space-y-3">
      {live.length > 0 && (
        <section>
          <h3 className="text-xs font-bold text-red-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />
            진행 중 ({live.length})
          </h3>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {live.map((m) => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {scheduled.length > 0 && (
        <section>
          <h3 className="text-xs font-bold text-blue-700 uppercase tracking-widest mb-2">
            예정 경기 ({scheduled.length})
          </h3>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {scheduled.map((m) => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {done.length > 0 && (
        <section>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
            완료 ({done.length})
          </h3>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {done.map((m) => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {sorted.length === 0 && (
        <p className="text-center text-gray-400 py-8 text-sm">등록된 경기가 없습니다.</p>
      )}
    </div>
  );
}

export default function LiveScore() {
  const { id } = useParams();

  const [tournament, setTournament] = useState(null);
  const [categories, setCategories] = useState([]);
  const [matches, setMatches] = useState([]);
  const [activeCatId, setActiveCatId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const loadData = useCallback(async () => {
    try {
      // 1. Tournament
      const { data: trn, error: trnErr } = await supabase
        .from('tournaments')
        .select('*')
        .eq('id', id)
        .single();
      if (trnErr) throw trnErr;
      setTournament(trn);

      // 2. Categories
      const { data: cats, error: catsErr } = await supabase
        .from('tournament_categories')
        .select('*')
        .eq('tournament_id', id)
        .order('name');
      if (catsErr) throw catsErr;
      setCategories(cats ?? []);
      if (cats?.length > 0 && !activeCatId) {
        setActiveCatId(cats[0].id);
      }

      // 3. Matches with scores + team entries + player profiles
      const { data: mts, error: mtsErr } = await supabase
        .from('tournament_matches')
        .select(`
          *,
          match_scores(*),
          team1_entry:tournament_entries!team1_entry_id(
            id,
            players:tournament_entry_players(
              profile:profiles(name, username)
            )
          ),
          team2_entry:tournament_entries!team2_entry_id(
            id,
            players:tournament_entry_players(
              profile:profiles(name, username)
            )
          )
        `)
        .eq('tournament_id', id)
        .order('scheduled_time', { nullsFirst: false });
      if (mtsErr) throw mtsErr;
      setMatches(mts ?? []);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('[LiveScore] load error', err);
      setError(err.message ?? '데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [id, activeCatId]);

  // Initial load
  useEffect(() => {
    loadData();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 30초 자동 갱신 — 탭이 백그라운드일 땐 폴링 중단(배터리·네트워크 절약), 복귀 시 즉시 최신화
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

  // Supabase realtime subscription
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`live-score-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournament_matches', filter: `tournament_id=eq.${id}` },
        () => loadData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_scores' },
        () => loadData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, loadData]);

  const activeCat = categories.find((c) => c.id === activeCatId);
  const catMatches = matches.filter((m) => m.category_id === activeCatId);

  const liveCount = matches.filter((m) => m.status === 'IN_PROGRESS').length;

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-4">
        <div className="w-10 h-10 rounded-full border-4 border-red-600 border-t-transparent animate-spin" />
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
      {/* Header */}
      <header
        className="sticky top-0 z-20 shadow-md"
        style={{ background: 'linear-gradient(135deg, #003478 0%, #C60C30 100%)' }}
      >
        <div className="max-w-6xl mx-auto px-4 py-4">
          {/* Top row */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {liveCount > 0 ? (
                  <span className="flex items-center gap-1.5 bg-red-600 text-white text-xs font-extrabold px-2.5 py-1 rounded-full animate-pulse shadow">
                    <Wifi size={12} />
                    LIVE {liveCount}경기
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
                {tournament.name}
              </h1>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {tournament.start_date && (
                  <span className="flex items-center gap-1 text-white/80 text-xs">
                    <Clock size={12} />
                    {new Date(tournament.start_date).toLocaleDateString('ko-KR', {
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
              갱신: {lastRefresh.toLocaleTimeString('ko-KR')} · 30초마다 자동 갱신
            </p>
          )}
        </div>

        {/* Category tabs */}
        {categories.length > 0 && (
          <div className="border-t border-white/20">
            <div className="max-w-6xl mx-auto px-4">
              <div className="flex overflow-x-auto gap-1 py-2 scrollbar-hide">
                {categories.map((cat) => {
                  const catLive = matches.filter(
                    (m) => m.category_id === cat.id && m.status === 'IN_PROGRESS'
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
                      {cat.name}
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

      {/* Main content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-5">
        {activeCat ? (
          <CategorySection category={activeCat} matches={catMatches} />
        ) : categories.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Trophy size={48} className="mx-auto mb-3 opacity-30" />
            <p className="font-semibold">등록된 종목이 없습니다.</p>
          </div>
        ) : null}
      </main>

      {/* Footer CTA */}
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
