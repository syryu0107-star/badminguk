-- ============================================================
-- 012_grade_promotion.sql
-- 배드민국 "급수 자동 승급 심사(D)" — 입상 이력 기반 급수 원장(ledger)
--
-- 도메인 원칙:
--   · 공인 급수(official_grade / singles_grade)는 원칙적으로 "안 떨어진다".
--     → 강급(demotion)은 기본 비활성(demotion_enabled=false). 훅만 남겨둔다.
--   · 승급은 "대회 입상(우승/준우승/3위) 누적"으로만 발생. 비공인(none) 대회는 불인정.
--   · 자동 승급 상한은 A조(index 5). 준자강·자강조는 전국대회/선수출신 심사 영역이라
--     운영(백오피스)이 수동으로만 올린다.
--   · 승급 규칙 수치는 grade_promotion_config(단일 행)로 운영이 조정 가능.
--
-- 설계 철학(010 apply_match_mmr과 동일):
--   · 상태를 누적 카운터로 두지 않고, "불변 원천(tournament_entries.final_rank +
--     tournaments.cert_level)"에서 매번 재계산 → 몇 번을 돌려도 같은 결과(멱등).
--   · 권한은 SECURITY DEFINER RPC 한 곳(promote_grades_for_tournament)에서만 검증하고,
--     내부 평가 함수는 PUBLIC 실행 권한을 회수해 임의 승급을 차단한다.
--
-- 규칙: 기존 마이그레이션(001~011) 수정 금지. 전부 멱등
--       (IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT / DROP POLICY IF EXISTS).
-- ============================================================


-- ============================================================
-- 0. profiles: 승급 추적 컬럼
--    (official_grade / singles_grade 는 001·005에 이미 존재 → 추가 안 함)
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS grade_promoted_at         TIMESTAMPTZ,  -- 복식 최근 자동승급 시각
  ADD COLUMN IF NOT EXISTS singles_grade_promoted_at TIMESTAMPTZ;  -- 단식 최근 자동승급 시각

COMMENT ON COLUMN profiles.grade_promoted_at         IS '복식 official_grade 최근 자동 승급 시각(승급 유예/축하배지 기준)';
COMMENT ON COLUMN profiles.singles_grade_promoted_at IS '단식 singles_grade 최근 자동 승급 시각';


-- ============================================================
-- 1. 급수 인덱스 매핑 — src/lib/grades.js GRADES 순서를 1:1 재현
--    (약→강) 왕초심0 초심1 D조2 C조3 B조4 A조5 준자강6 자강조7
-- ============================================================
CREATE OR REPLACE FUNCTION bmg_grade_idx(g text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE g
           WHEN '왕초심' THEN 0
           WHEN '초심'   THEN 1
           WHEN 'D조'    THEN 2
           WHEN 'C조'    THEN 3
           WHEN 'B조'    THEN 4
           WHEN 'A조'    THEN 5
           WHEN '준자강' THEN 6
           WHEN '자강조' THEN 7
           ELSE 0                       -- 미지의 값은 왕초심으로 안전 처리
         END
$$;

CREATE OR REPLACE FUNCTION bmg_grade_at(i integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE i
           WHEN 0 THEN '왕초심'
           WHEN 1 THEN '초심'
           WHEN 2 THEN 'D조'
           WHEN 3 THEN 'C조'
           WHEN 4 THEN 'B조'
           WHEN 5 THEN 'A조'
           WHEN 6 THEN '준자강'
           WHEN 7 THEN '자강조'
           ELSE '자강조'                 -- 상한 클램프
         END
$$;


-- ============================================================
-- 2. 승급 규칙 설정 (단일 행) — 운영이 조정 가능
-- ============================================================
CREATE TABLE IF NOT EXISTS grade_promotion_config (
  id                 INTEGER PRIMARY KEY DEFAULT 1,
  -- 입상 기본 점수 (최종순위별)
  win_points         NUMERIC NOT NULL DEFAULT 3,    -- 우승(final_rank=1)
  runnerup_points    NUMERIC NOT NULL DEFAULT 2,    -- 준우승(2)
  semi_points        NUMERIC NOT NULL DEFAULT 1,    -- 3위(3)
  -- 공인등급(cert_level) 가중치. none(비공인)은 0 → 승급 불인정(하드코딩)
  cert_mult_a        NUMERIC NOT NULL DEFAULT 2.0,  -- 공인A(협회 연계)
  cert_mult_b        NUMERIC NOT NULL DEFAULT 1.5,  -- 공인B(인증 주최자)
  cert_mult_c        NUMERIC NOT NULL DEFAULT 1.0,  -- 공인C(일반 동호회)
  -- 한 단계 승급에 필요한 누적 점수 = threshold_base + threshold_step * (현재 급수 index)
  --   → 급수가 올라갈수록 승급이 어려워진다.
  --   기본: C조(idx3)→B조 = 3 + 1.5*3 = 7.5점,  초심(idx1)→D조 = 3 + 1.5 = 4.5점
  threshold_base     NUMERIC NOT NULL DEFAULT 3.0,
  threshold_step     NUMERIC NOT NULL DEFAULT 1.5,
  -- 자동 승급 상한 index. 5=A조. 준자강(6)·자강조(7)은 수동 심사 전용.
  max_auto_grade_idx INTEGER NOT NULL DEFAULT 5,
  -- 승급 유예(일). 승급 후 이 기간은 이전 급수로도 출전 허용(eligibility 게이트에서 참조).
  grace_days         INTEGER NOT NULL DEFAULT 30,
  -- 강급 사용 여부. 원칙상 급수는 안 떨어짐 → 기본 false. (훅만 존재, 로직 미구현)
  demotion_enabled   BOOLEAN NOT NULL DEFAULT false,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_gpc_singleton CHECK (id = 1)
);

INSERT INTO grade_promotion_config (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE grade_promotion_config ENABLE ROW LEVEL SECURITY;

-- 읽기: 공개 (프로필 "승급까지 X점" 프리뷰에서 사용)
DROP POLICY IF EXISTS "gpc_read_all" ON grade_promotion_config;
CREATE POLICY "gpc_read_all" ON grade_promotion_config FOR SELECT USING (true);

-- 수정: 주최자(role='organizer')만. (백오피스 admin 역할은 6-6에서 신설 예정)
DROP POLICY IF EXISTS "gpc_update_organizer" ON grade_promotion_config;
CREATE POLICY "gpc_update_organizer" ON grade_promotion_config FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'organizer'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'organizer'));


-- ============================================================
-- 3. grade_history — 급수 변동 원장(승급 타임라인/축하배지 소스)
-- ============================================================
CREATE TABLE IF NOT EXISTS grade_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_mode       TEXT NOT NULL,                 -- 'singles' | 'doubles'
  from_grade      TEXT NOT NULL,
  to_grade        TEXT NOT NULL,
  reason          TEXT NOT NULL DEFAULT '입상 누적 승급',
  tournament_id   UUID REFERENCES tournaments(id) ON DELETE SET NULL,  -- 승급을 촉발한 대회
  points_snapshot NUMERIC,                        -- 승급 시점 누적 입상점수(감사용)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_grade_history_mode CHECK (game_mode IN ('singles','doubles'))
);

CREATE INDEX IF NOT EXISTS idx_grade_history_player
  ON grade_history (player_id, game_mode, created_at DESC);

COMMENT ON TABLE  grade_history          IS '급수 변동 원장. 자동승급(reason=입상 누적 승급) 및 수동조정(reason=manual_adjust) 기록';
COMMENT ON COLUMN grade_history.reason   IS '"입상 누적 승급"(자동) | "manual_adjust"(백오피스 수동) 등. 자동승급 카운트는 정확히 "입상 누적 승급"만 집계';

ALTER TABLE grade_history ENABLE ROW LEVEL SECURITY;

-- 읽기: 공개 (프로필 승급 타임라인)
DROP POLICY IF EXISTS "grade_history_read_all" ON grade_history;
CREATE POLICY "grade_history_read_all" ON grade_history FOR SELECT USING (true);

-- 쓰기: 직접 INSERT/UPDATE/DELETE 정책 없음(=일반 세션 쓰기 차단).
--   SECURITY DEFINER 평가 함수만 기록한다(mmr_history와 동일한 잠금 모델).

-- 실시간 구독(프로필에서 승급 축하 토스트를 즉시 띄우고 싶을 때)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE grade_history;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END
$$;


-- ============================================================
-- 4. bmg_earned_promo_points — 한 선수의 (모드별) 누적 입상 점수
--    불변 원천에서 재계산: 승인된 참가 + 입상(final_rank 1~3, prize_spots 이내)
--    + 공인대회(cert_level a/b/c)만.  순위별 기본점 × 공인등급 가중.
-- ============================================================
CREATE OR REPLACE FUNCTION bmg_earned_promo_points(p_player uuid, p_mode text)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(
      (CASE e.final_rank
         WHEN 1 THEN cfg.win_points
         WHEN 2 THEN cfg.runnerup_points
         WHEN 3 THEN cfg.semi_points
         ELSE 0 END)
    * (CASE t.cert_level
         WHEN 'a' THEN cfg.cert_mult_a
         WHEN 'b' THEN cfg.cert_mult_b
         WHEN 'c' THEN cfg.cert_mult_c
         ELSE 0 END)
  ), 0)
  FROM tournament_entries e
  JOIN tournament_categories c ON c.id = e.category_id
  JOIN tournaments          t ON t.id = c.tournament_id
  CROSS JOIN grade_promotion_config cfg
  WHERE cfg.id = 1
    AND (e.player1_id = p_player OR e.player2_id = p_player)
    AND e.entry_status = 'approved'
    AND e.final_rank IS NOT NULL
    AND e.final_rank BETWEEN 1 AND 3
    AND e.final_rank <= COALESCE(c.prize_spots, 3)   -- 참가규모별 입상 범위
    AND t.cert_level IN ('a','b','c')                -- 비공인(none)은 불인정
    AND (CASE WHEN c.sport_type IN ('남단','여단') THEN 'singles' ELSE 'doubles' END) = p_mode
$$;
-- 임의 조회는 무해(공개 데이터 집계)하지만 최소권한 원칙상 회수 후 authenticated에만 부여
REVOKE ALL ON FUNCTION bmg_earned_promo_points(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bmg_earned_promo_points(uuid, text) TO authenticated;


-- ============================================================
-- 5. bmg_eval_promotion — 선수 1명·모드 1개 승급 판정 + 반영(내부 전용)
--    멱등 핵심:
--      anchor_idx = 현재급수 index − (이미 반영된 자동승급 수)
--        → 재실행마다 현재index와 자동승급수가 같이 증가하므로 anchor는 불변.
--      earned = 전체 입상점수(불변).  anchor에서 그리디로 임계값을 소진하며 상승.
--      target = 그리디 종착 index.  target<=현재면 no-op(그리고 절대 강등 안 함).
--    수동조정(reason=manual_adjust)로 올린 급수는 자동승급수에 안 잡혀 anchor 바닥에
--    그대로 반영 → 수동상향은 "바닥을 올리고" 그 위로 입상점수가 쌓인다(강등 없음).
-- ============================================================
CREATE OR REPLACE FUNCTION bmg_eval_promotion(p_player uuid, p_mode text, p_tournament uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cfg         grade_promotion_config%ROWTYPE;
  v_cur_grade text;
  v_cur_idx   integer;
  v_autos     integer;
  v_anchor    integer;
  v_pts       numeric;
  v_idx       integer;
  v_thresh    numeric;
  v_target    text;
  i           integer;
BEGIN
  SELECT * INTO cfg FROM grade_promotion_config WHERE id = 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- 현재 급수(행 잠금) — 모드별 컬럼
  IF p_mode = 'singles' THEN
    SELECT singles_grade  INTO v_cur_grade FROM profiles WHERE id = p_player FOR UPDATE;
  ELSE
    SELECT official_grade INTO v_cur_grade FROM profiles WHERE id = p_player FOR UPDATE;
  END IF;
  IF v_cur_grade IS NULL THEN RETURN NULL; END IF;

  v_cur_idx := bmg_grade_idx(v_cur_grade);

  -- 이미 반영된 자동 승급 횟수(정확히 '입상 누적 승급'만)
  SELECT count(*) INTO v_autos
    FROM grade_history
   WHERE player_id = p_player AND game_mode = p_mode AND reason = '입상 누적 승급';

  v_anchor := greatest(0, v_cur_idx - v_autos);
  v_pts    := bmg_earned_promo_points(p_player, p_mode);

  -- anchor에서 그리디 상승 (자동 상한 max_auto_grade_idx 까지만)
  v_idx := v_anchor;
  LOOP
    EXIT WHEN v_idx >= cfg.max_auto_grade_idx;
    v_thresh := cfg.threshold_base + cfg.threshold_step * v_idx;
    EXIT WHEN v_pts < v_thresh;
    v_pts := v_pts - v_thresh;
    v_idx := v_idx + 1;
  END LOOP;

  -- 승급 없음(그리고 절대 강등하지 않음)
  IF v_idx <= v_cur_idx THEN
    RETURN NULL;
  END IF;

  v_target := bmg_grade_at(v_idx);

  -- 프로필 반영
  IF p_mode = 'singles' THEN
    UPDATE profiles
       SET singles_grade = v_target, singles_grade_promoted_at = NOW()
     WHERE id = p_player;
  ELSE
    UPDATE profiles
       SET official_grade = v_target, grade_promoted_at = NOW()
     WHERE id = p_player;
  END IF;

  -- 단계별 원장 기록 (여러 단계 점프 시 각 단계 한 줄씩)
  i := v_cur_idx + 1;
  WHILE i <= v_idx LOOP
    INSERT INTO grade_history
      (player_id, game_mode, from_grade, to_grade, reason, tournament_id, points_snapshot)
    VALUES
      (p_player, p_mode, bmg_grade_at(i - 1), bmg_grade_at(i),
       '입상 누적 승급', p_tournament, bmg_earned_promo_points(p_player, p_mode));
    i := i + 1;
  END LOOP;

  RETURN v_target;
END;
$$;
-- 내부 전용: 직접 호출 차단(임의 승급 방지). 래퍼(정의자 소유)에서만 호출.
REVOKE ALL ON FUNCTION bmg_eval_promotion(uuid, text, uuid) FROM PUBLIC;


-- ============================================================
-- 6. promote_grades_for_tournament — 공개 RPC (SECURITY DEFINER)
--    대회 종료(finalizeTournament) 직후, 이 대회 전체 참가자를 (모드별) 일괄 심사.
--    권한: 이 대회의 주최자만 실행 가능(apply_match_mmr와 동일 모델).
--    멱등: 내부 평가가 멱등 → 두 번 호출해도 중복 승급 없음.
--    반환: 이번 호출로 승급된 목록 jsonb 배열.
-- ============================================================
CREATE OR REPLACE FUNCTION promote_grades_for_tournament(p_tournament uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org    uuid;
  v_rec    record;
  v_new    text;
  v_result jsonb := '[]'::jsonb;
BEGIN
  SELECT organizer_id INTO v_org FROM tournaments WHERE id = p_tournament;
  IF NOT FOUND THEN
    RAISE EXCEPTION '대회를 찾을 수 없습니다: %', p_tournament;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> v_org THEN
    RAISE EXCEPTION '권한이 없습니다: 이 대회의 주최자만 승급 심사를 실행할 수 있습니다';
  END IF;

  -- 이 대회 승인 참가자 전체 (신청자+파트너), 종목 성별로 모드 판별
  FOR v_rec IN
    SELECT DISTINCT player_id, mode FROM (
      SELECT e.player1_id AS player_id,
             CASE WHEN c.sport_type IN ('남단','여단') THEN 'singles' ELSE 'doubles' END AS mode
        FROM tournament_entries e
        JOIN tournament_categories c ON c.id = e.category_id
       WHERE c.tournament_id = p_tournament
         AND e.entry_status = 'approved'
         AND e.player1_id IS NOT NULL
      UNION
      SELECT e.player2_id AS player_id,
             CASE WHEN c.sport_type IN ('남단','여단') THEN 'singles' ELSE 'doubles' END AS mode
        FROM tournament_entries e
        JOIN tournament_categories c ON c.id = e.category_id
       WHERE c.tournament_id = p_tournament
         AND e.entry_status = 'approved'
         AND e.player2_id IS NOT NULL
    ) q
    WHERE q.player_id IS NOT NULL
  LOOP
    v_new := bmg_eval_promotion(v_rec.player_id, v_rec.mode, p_tournament);
    IF v_new IS NOT NULL THEN
      v_result := v_result || jsonb_build_object(
        'player_id', v_rec.player_id,
        'mode',      v_rec.mode,
        'to_grade',  v_new
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION promote_grades_for_tournament(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION promote_grades_for_tournament(uuid) TO authenticated;


-- ============================================================
-- 7. grade_promotion_progress — 프로필용 읽기 전용 프리뷰
--    "다음 급수까지 남은 점수" 계산(반영은 하지 않음). 승급 동기부여 UI 소스.
-- ============================================================
CREATE OR REPLACE FUNCTION grade_promotion_progress(p_player uuid, p_mode text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cfg         grade_promotion_config%ROWTYPE;
  v_cur_grade text;
  v_cur_idx   integer;
  v_autos     integer;
  v_anchor    integer;
  v_pts       numeric;
  v_idx       integer;
  v_thresh    numeric;
  v_at_cap    boolean;
BEGIN
  SELECT * INTO cfg FROM grade_promotion_config WHERE id = 1;

  IF p_mode = 'singles' THEN
    SELECT singles_grade  INTO v_cur_grade FROM profiles WHERE id = p_player;
  ELSE
    SELECT official_grade INTO v_cur_grade FROM profiles WHERE id = p_player;
  END IF;
  IF v_cur_grade IS NULL THEN RETURN NULL; END IF;

  v_cur_idx := bmg_grade_idx(v_cur_grade);

  SELECT count(*) INTO v_autos
    FROM grade_history
   WHERE player_id = p_player AND game_mode = p_mode AND reason = '입상 누적 승급';

  v_anchor := greatest(0, v_cur_idx - v_autos);
  v_pts    := bmg_earned_promo_points(p_player, p_mode);

  -- 이미 소진된 임계값을 빼서 "현재 급수 이후의 잔여 점수"를 구한다
  v_idx := v_anchor;
  WHILE v_idx < v_cur_idx LOOP
    v_pts   := v_pts - (cfg.threshold_base + cfg.threshold_step * v_idx);
    v_idx   := v_idx + 1;
  END LOOP;

  v_at_cap := (v_cur_idx >= cfg.max_auto_grade_idx);
  IF v_at_cap THEN
    RETURN jsonb_build_object(
      'current_grade', v_cur_grade,
      'at_auto_cap',   true,
      'next_grade',    NULL,
      'points',        round(greatest(v_pts, 0), 2),
      'points_needed', NULL,
      'remaining',     NULL
    );
  END IF;

  v_thresh := cfg.threshold_base + cfg.threshold_step * v_cur_idx;
  RETURN jsonb_build_object(
    'current_grade', v_cur_grade,
    'at_auto_cap',   false,
    'next_grade',    bmg_grade_at(v_cur_idx + 1),
    'points',        round(greatest(v_pts, 0), 2),
    'points_needed', v_thresh,
    'remaining',     round(greatest(v_thresh - v_pts, 0), 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION grade_promotion_progress(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grade_promotion_progress(uuid, text) TO authenticated;

-- ============================================================
-- 끝. 통합 지점(계약):
--   finalizeTournament(src/lib/advance.js) 안에서 finalizeRanks 루프가 끝난 뒤
--   (=모든 종목 final_rank 확정 후), status='completed' 갱신 근처에서 1회:
--     await supabase.rpc('promote_grades_for_tournament', { p_tournament: tournamentId })
-- ============================================================
