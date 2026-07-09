-- ============================================================
-- 010_completion_fixes.sql
-- 배드민국 "완주 최소선": MMR을 서버측 SECURITY DEFINER RPC로 이관.
--   · 지금까지 MMR은 주최자 브라우저가 남의 profiles를 직접 UPDATE → RLS(본인만 수정)에
--     막혀 조용히 0행 갱신(silent no-op). 랭킹이 영구히 "데이터 없음".
--   · 이 파일은 apply_match_mmr(match_id) RPC 하나로 profiles + mmr_history 를 원자적으로
--     갱신하고, 조작 경로(match_scores / mmr_history 직접 write)를 닫는다.
--
-- 규칙: 기존 마이그레이션(001~009) 수정 금지. 전부 멱등(IF NOT EXISTS / CREATE OR REPLACE
--       / DROP POLICY IF EXISTS)이라 반복 실행 안전.
--
-- 참조 정본: src/lib/mmr.js (Elo 로직을 아래 PL/pgSQL로 1:1 재현)
-- ============================================================


-- ------------------------------------------------------------
-- 0. tournament_matches.mmr_applied (001에 이미 존재하나 방어적으로 보장)
-- ------------------------------------------------------------
ALTER TABLE tournament_matches
  ADD COLUMN IF NOT EXISTS mmr_applied BOOLEAN NOT NULL DEFAULT false;


-- ============================================================
-- 1. Elo 헬퍼 함수들 — mmr.js 를 그대로 옮김
-- ============================================================

-- mmr.js 는 Math.round (반올림이 +∞ 방향: round(-2.5) = -2) 를 쓴다.
-- Postgres round() 는 0에서 먼 쪽(round(-2.5) = -3)이라 부호가 있는 .5에서 어긋난다.
-- 파리티를 위해 floor(x + 0.5) 로 Math.round 를 정확히 재현한다.
CREATE OR REPLACE FUNCTION bmg_js_round(x double precision)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT floor(x + 0.5)::integer
$$;

-- CERT_LEVELS[cert].k  (mmr.js:6-11).  none/미지원 → 0
CREATE OR REPLACE FUNCTION bmg_cert_k(cert text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE cert
           WHEN 'a' THEN 64
           WHEN 'b' THEN 48
           WHEN 'c' THEN 32
           ELSE 0
         END
$$;

-- kFactor(baseK, gamesPlayed)  (mmr.js:14-17)
-- baseK=0 → 0.  신규(10경기 미만) → round(baseK*1.5).  그 외 baseK.
CREATE OR REPLACE FUNCTION bmg_k_factor(base_k integer, games integer)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN base_k = 0    THEN 0
           WHEN games < 10    THEN bmg_js_round(base_k * 1.5)
           ELSE base_k
         END
$$;

-- expected(playerMMR, opponentMMR)  (mmr.js:20-22)
CREATE OR REPLACE FUNCTION bmg_expected(mine double precision, opp double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT 1.0 / (1.0 + power(10.0, (opp - mine) / 400.0))
$$;

-- partnerAdjustment(myMMR, partnerMMR)  (mmr.js:27-31)
-- factor = 1 - (partner-my)/400 * 0.25,  clamp [0.4, 1.6]
CREATE OR REPLACE FUNCTION bmg_partner_adj(my_mmr double precision, partner_mmr double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT greatest(0.4, least(1.6, 1.0 - ((partner_mmr - my_mmr) / 400.0) * 0.25))
$$;


-- ============================================================
-- 2. bmg_apply_player — 선수 1명 반영 (delta 계산 + profiles UPDATE + mmr_history INSERT)
--    ⚠️ 모든 입력 MMR/게임수는 "경기 전(pre-match)" 스냅샷이어야 한다.
--       mmr.js resolveMatchMMR 은 4명 delta 를 전부 경기 전 값으로 계산한 뒤 반영하므로,
--       파트너/상대 평균을 경기 전 값으로 넘겨 순서 의존 버그를 원천 차단한다.
--    p_partner_mmr 이 NULL 이면 파트너 보정 없음(단식 또는 파트너 부재).
-- ============================================================
CREATE OR REPLACE FUNCTION bmg_apply_player(
  p_player       uuid,
  p_mmr          integer,             -- 경기 전 내 MMR
  p_games        integer,             -- 경기 전 내 게임수
  p_partner_mmr  integer,             -- 경기 전 파트너 MMR (NULL=보정 없음)
  p_opp_avg      double precision,    -- 상대 팀 평균 MMR
  p_result       integer,             -- 1=승, 0=패
  p_cert         text,
  p_mode         text,                -- 'singles' | 'doubles'
  p_tournament   uuid,
  p_match        uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_base_k     integer;
  v_k          integer;
  v_e          double precision;
  v_delta_base integer;
  v_adj        double precision;
  v_delta      integer;
  v_after      integer;
  v_adj_pct    integer;
BEGIN
  -- calcMMRDelta (mmr.js:34-40)
  v_base_k := bmg_cert_k(p_cert);
  v_k      := bmg_k_factor(v_base_k, p_games);
  IF v_k = 0 THEN
    v_delta_base := 0;
  ELSE
    v_e          := bmg_expected(p_mmr, p_opp_avg);
    v_delta_base := bmg_js_round(v_k * (p_result - v_e));
  END IF;

  -- 파트너 보정 (mmr.js:63-73)
  IF p_partner_mmr IS NULL THEN
    v_adj := 1.0;
  ELSE
    v_adj := bmg_partner_adj(p_mmr, p_partner_mmr);
  END IF;

  v_delta   := bmg_js_round(v_delta_base * v_adj);
  v_after   := greatest(100, p_mmr + v_delta);          -- Math.max(100, ...)
  v_adj_pct := bmg_js_round((v_adj - 1.0) * 100);       -- partnerAdj (%)

  IF p_mode = 'singles' THEN
    UPDATE profiles
       SET singles_mmr = v_after,
           singles_games_played = p_games + 1
     WHERE id = p_player;
  ELSE
    UPDATE profiles
       SET mmr = v_after,
           mmr_games_played = p_games + 1
     WHERE id = p_player;
  END IF;

  INSERT INTO mmr_history
    (player_id, tournament_id, match_id, mmr_before, mmr_after, delta, cert_level, partner_adj, game_mode)
  VALUES
    (p_player, p_tournament, p_match, p_mmr, v_after, v_delta, p_cert, v_adj_pct, p_mode);
END;
$$;


-- ============================================================
-- 3. apply_match_mmr(p_match_id) — 공개 RPC (SECURITY DEFINER)
-- ============================================================
CREATE OR REPLACE FUNCTION apply_match_mmr(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match       tournament_matches%ROWTYPE;
  v_org         uuid;
  v_tournament  uuid;
  v_cert        text;
  v_t1e         tournament_entries%ROWTYPE;
  v_t2e         tournament_entries%ROWTYPE;
  v_doubles     boolean;
  v_wside       integer;   -- 1=팀1 승, 2=팀2 승
  v_r1          integer;
  v_r2          integer;
  -- 경기 전 스냅샷 (a=팀1선수1, b=팀1선수2, c=팀2선수1, d=팀2선수2)
  v_a_mmr integer; v_a_games integer;
  v_b_mmr integer; v_b_games integer;
  v_c_mmr integer; v_c_games integer;
  v_d_mmr integer; v_d_games integer;
  v_t1avg double precision;
  v_t2avg double precision;
BEGIN
  -- 3.1 경기 로드
  SELECT * INTO v_match FROM tournament_matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '경기를 찾을 수 없습니다: %', p_match_id;
  END IF;

  -- 3.2 대회 / 주최자 / 공인등급 해석
  SELECT t.id, t.organizer_id, t.cert_level
    INTO v_tournament, v_org, v_cert
    FROM tournament_categories tc
    JOIN tournaments t ON t.id = tc.tournament_id
   WHERE tc.id = v_match.category_id;

  -- 3.3 권한 검증 — 호출자가 이 대회의 주최자여야 함 (단일계정 운영 전제)
  IF auth.uid() IS NULL OR auth.uid() <> v_org THEN
    RAISE EXCEPTION '권한이 없습니다: 이 대회의 주최자만 MMR을 반영할 수 있습니다';
  END IF;

  -- 3.4 멱등 — 이미 반영됐으면 아무것도 안 함
  IF v_match.mmr_applied THEN
    RETURN;
  END IF;

  -- 3.5 walkover(불참 부전승) → MMR 미반영, 처리완료 표시만 (계약)
  IF v_match.result_type = 'walkover' THEN
    UPDATE tournament_matches SET mmr_applied = true WHERE id = p_match_id;
    RETURN;
  END IF;

  -- 3.6 승자/양팀이 없으면(부전승 bye·미완료) 반영 불가 → 처리완료 표시만
  IF v_match.winner_entry_id IS NULL
     OR v_match.team1_entry_id IS NULL
     OR v_match.team2_entry_id IS NULL THEN
    UPDATE tournament_matches SET mmr_applied = true WHERE id = p_match_id;
    RETURN;
  END IF;

  -- 3.7 비공인(none) → 친선, MMR 미반영. 처리완료 표시만 (mmr.js:51-55)
  IF v_cert IS NULL OR bmg_cert_k(v_cert) = 0 THEN
    UPDATE tournament_matches SET mmr_applied = true WHERE id = p_match_id;
    RETURN;
  END IF;

  -- 3.8 엔트리(팀) 로드
  SELECT * INTO v_t1e FROM tournament_entries WHERE id = v_match.team1_entry_id;
  SELECT * INTO v_t2e FROM tournament_entries WHERE id = v_match.team2_entry_id;

  -- 단식/복식 판별: 양팀 모두 player2 가 있으면 복식, 아니면 단식
  v_doubles := (v_t1e.player2_id IS NOT NULL AND v_t2e.player2_id IS NOT NULL);

  v_wside := CASE WHEN v_match.winner_entry_id = v_match.team1_entry_id THEN 1 ELSE 2 END;
  v_r1    := CASE WHEN v_wside = 1 THEN 1 ELSE 0 END;
  v_r2    := 1 - v_r1;

  IF v_doubles THEN
    -- ── 복식: 4명, 파트너 보정 포함 ─────────────────────────────
    -- 경기 전 스냅샷 4명 (행 잠금)
    SELECT mmr, mmr_games_played INTO v_a_mmr, v_a_games
      FROM profiles WHERE id = v_t1e.player1_id FOR UPDATE;
    SELECT mmr, mmr_games_played INTO v_b_mmr, v_b_games
      FROM profiles WHERE id = v_t1e.player2_id FOR UPDATE;
    SELECT mmr, mmr_games_played INTO v_c_mmr, v_c_games
      FROM profiles WHERE id = v_t2e.player1_id FOR UPDATE;
    SELECT mmr, mmr_games_played INTO v_d_mmr, v_d_games
      FROM profiles WHERE id = v_t2e.player2_id FOR UPDATE;

    -- teamMMR = round((p1+p2)/2)  (mmr.js:42-44, 57-58)
    v_t1avg := bmg_js_round((v_a_mmr + v_b_mmr) / 2.0);
    v_t2avg := bmg_js_round((v_c_mmr + v_d_mmr) / 2.0);

    -- 4명 반영 (모두 경기 전 값 기준 → 순서 무관)
    PERFORM bmg_apply_player(v_t1e.player1_id, v_a_mmr, v_a_games, v_b_mmr, v_t2avg, v_r1, v_cert, 'doubles', v_tournament, p_match_id);
    PERFORM bmg_apply_player(v_t1e.player2_id, v_b_mmr, v_b_games, v_a_mmr, v_t2avg, v_r1, v_cert, 'doubles', v_tournament, p_match_id);
    PERFORM bmg_apply_player(v_t2e.player1_id, v_c_mmr, v_c_games, v_d_mmr, v_t1avg, v_r2, v_cert, 'doubles', v_tournament, p_match_id);
    PERFORM bmg_apply_player(v_t2e.player2_id, v_d_mmr, v_d_games, v_c_mmr, v_t1avg, v_r2, v_cert, 'doubles', v_tournament, p_match_id);

  ELSE
    -- ── 단식: 2명, 파트너 보정 없음, singles_* 컬럼 ─────────────
    SELECT singles_mmr, singles_games_played INTO v_a_mmr, v_a_games
      FROM profiles WHERE id = v_t1e.player1_id FOR UPDATE;
    SELECT singles_mmr, singles_games_played INTO v_c_mmr, v_c_games
      FROM profiles WHERE id = v_t2e.player1_id FOR UPDATE;

    -- 단식은 teamMMR(x,x)=x → 상대 평균은 상대 본인 MMR
    PERFORM bmg_apply_player(v_t1e.player1_id, v_a_mmr, v_a_games, NULL, v_c_mmr::double precision, v_r1, v_cert, 'singles', v_tournament, p_match_id);
    PERFORM bmg_apply_player(v_t2e.player1_id, v_c_mmr, v_c_games, NULL, v_a_mmr::double precision, v_r2, v_cert, 'singles', v_tournament, p_match_id);
  END IF;

  -- 3.9 반영 완료 표시
  UPDATE tournament_matches SET mmr_applied = true WHERE id = p_match_id;
END;
$$;

-- 실행 권한: authenticated 만 (definer 함수 → PUBLIC 기본 GRANT 회수)
REVOKE ALL ON FUNCTION apply_match_mmr(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_match_mmr(uuid) TO authenticated;


-- ============================================================
-- 4. match_scores RLS 재작성 — 주최자 범위로 제한 (S4)
--    기존: FOR ALL USING(auth.uid() IS NOT NULL)  → 아무 로그인 유저가 조작
--    변경: match→category→tournament.organizer_id = auth.uid() 인 경우만 write.
--          읽기(SELECT "누구나 읽기")는 001 정책 그대로 유지 → 공개.
-- ============================================================
DROP POLICY IF EXISTS "인증된 사용자 관리" ON match_scores;

DROP POLICY IF EXISTS "주최자 점수 관리" ON match_scores;
CREATE POLICY "주최자 점수 관리" ON match_scores FOR ALL
  USING (
    auth.uid() = (
      SELECT t.organizer_id
        FROM tournament_matches m
        JOIN tournament_categories tc ON tc.id = m.category_id
        JOIN tournaments t           ON t.id  = tc.tournament_id
       WHERE m.id = match_scores.match_id
    )
  )
  WITH CHECK (
    auth.uid() = (
      SELECT t.organizer_id
        FROM tournament_matches m
        JOIN tournament_categories tc ON tc.id = m.category_id
        JOIN tournaments t           ON t.id  = tc.tournament_id
       WHERE m.id = match_scores.match_id
    )
  );


-- ============================================================
-- 5. mmr_history RLS 재작성 — 직접 INSERT 차단 (M4)
--    기존: FOR INSERT WITH CHECK(auth.uid() IS NOT NULL) → 위조 가능
--    변경: 직접 INSERT 정책 제거. apply_match_mmr(SECURITY DEFINER)만 삽입.
--          읽기(SELECT "누구나 읽기")는 001 정책 그대로 유지 → 공개.
-- ============================================================
DROP POLICY IF EXISTS "인증된 사용자 삽입" ON mmr_history;
-- (대체 INSERT 정책을 만들지 않음 = 일반 세션의 직접 INSERT 차단.
--  RPC는 definer 권한으로 RLS를 우회하므로 정상 기록된다.)
