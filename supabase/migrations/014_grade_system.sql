-- ============================================================
-- 014_grade_system.sql
-- 배드민국 "급수 3축(단위 × 종목 × 조)" 재설계
--
-- 배경/도메인:
--   실제 배드민턴 급수는 "어느 단위 대회에서 인정받았는가"로 갈린다.
--   같은 사람이 구(區) 대회에선 C조, 시(市) 대회에선 D조, 전국에선 초심일 수 있다.
--   → 한 선수는 최대 6개 급수 트랙: 단위(구/시/전국) × 종목(단식/복식).
--
-- 3축:
--   · 단위(unit) : gu(구) / si(시) / nat(전국)   ← 새 축. 대회가 소속 단위를 가진다.
--   · 종목(mode) : singles(단식) / doubles(복식) ← 005에서 이미 분리.
--   · 조(grade)  : 왕초심~자강조 8단계 (grades.js GRADES, 012 bmg_grade_idx와 동일).
--
-- MMR과의 관계(중요):
--   · MMR은 실력점수(변동)로 단식/복식 2트랙만 유지(단위 무관). 기존 mmr/singles_mmr 그대로.
--   · 대회 MMR 반영강도 K는 "단위"로 결정: 구→K32 / 시→K48 / 전국→K64. 전부 반영.
--     구현: 기존 apply_match_mmr(010)는 cert_level(c/b/a) 기반이므로 건드리지 않고,
--           tournaments.unit → cert_level(gu→c, si→b, nat→a)로 저장 시 자동 매핑(아래 트리거).
--           → 010 MMR RPC를 수정 없이 재사용한다.
--
-- 승급과의 관계:
--   · 승급도 대회 unit·mode의 6트랙에 반영. 012 promote_grades_for_tournament는
--     official_grade/singles_grade(=시 트랙)만 올리므로 수정하지 않고,
--     새 promote_grades_v2(p_tournament)가 unit·mode에 맞는 트랙을 올린다(앱은 v2를 호출).
--   · 레거시 매핑: official_grade ≡ grade_si_dbl, singles_grade ≡ grade_si_sgl.
--     둘은 트리거로 lockstep 동기화 → 012·기존 UI가 계속 동작(시 트랙을 그대로 읽음).
--
-- 규칙: 기존 마이그레이션(001~013) 수정 금지. 전부 멱등
--       (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS / DO 가드).
-- ============================================================


-- ============================================================
-- 1. profiles: 6개 급수 트랙 컬럼 (TEXT, NULL = 미보유)
--    NULL 의미 = "그 단위에서 아직 급수 기록 없음". 승급/자격 계산 시 '왕초심'(idx0)로 간주.
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS grade_gu_dbl  TEXT,   -- 구   · 복식
  ADD COLUMN IF NOT EXISTS grade_si_dbl  TEXT,   -- 시   · 복식  (레거시 official_grade와 동기화)
  ADD COLUMN IF NOT EXISTS grade_nat_dbl TEXT,   -- 전국 · 복식
  ADD COLUMN IF NOT EXISTS grade_gu_sgl  TEXT,   -- 구   · 단식
  ADD COLUMN IF NOT EXISTS grade_si_sgl  TEXT,   -- 시   · 단식  (레거시 singles_grade와 동기화)
  ADD COLUMN IF NOT EXISTS grade_nat_sgl TEXT;   -- 전국 · 단식

COMMENT ON COLUMN profiles.grade_gu_dbl  IS '구 복식 급수(조). NULL=미보유';
COMMENT ON COLUMN profiles.grade_si_dbl  IS '시 복식 급수(조). 레거시 official_grade와 트리거로 동기화';
COMMENT ON COLUMN profiles.grade_nat_dbl IS '전국 복식 급수(조). NULL=미보유';
COMMENT ON COLUMN profiles.grade_gu_sgl  IS '구 단식 급수(조). NULL=미보유';
COMMENT ON COLUMN profiles.grade_si_sgl  IS '시 단식 급수(조). 레거시 singles_grade와 트리거로 동기화';
COMMENT ON COLUMN profiles.grade_nat_sgl IS '전국 단식 급수(조). NULL=미보유';

-- 시 트랙 = 레거시 컬럼 backfill (아직 비어있는 행만; 멱등)
UPDATE profiles SET grade_si_dbl = official_grade WHERE grade_si_dbl IS NULL AND official_grade IS NOT NULL;
UPDATE profiles SET grade_si_sgl = singles_grade  WHERE grade_si_sgl IS NULL AND singles_grade  IS NOT NULL;

-- 조 필터/정렬용 인덱스(선택)
CREATE INDEX IF NOT EXISTS idx_profiles_grade_gu_dbl  ON profiles(grade_gu_dbl);
CREATE INDEX IF NOT EXISTS idx_profiles_grade_si_dbl  ON profiles(grade_si_dbl);
CREATE INDEX IF NOT EXISTS idx_profiles_grade_nat_dbl ON profiles(grade_nat_dbl);


-- ============================================================
-- 2. 시 트랙 ↔ 레거시 컬럼 lockstep 동기화 트리거
--    · official_grade  ↔ grade_si_dbl
--    · singles_grade   ↔ grade_si_sgl
--    한쪽이 바뀌면 다른 쪽을 따라오게 해서 012(레거시)·v2(신규)가 공존해도 시 트랙이 갈라지지 않음.
-- ============================================================
CREATE OR REPLACE FUNCTION bmg_sync_si_grade()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- 삽입: 둘 중 값이 있는 쪽으로 통일(신규 6트랙 우선, 없으면 레거시)
    NEW.grade_si_dbl  := COALESCE(NEW.grade_si_dbl,  NEW.official_grade);
    NEW.official_grade := COALESCE(NEW.official_grade, NEW.grade_si_dbl);
    NEW.grade_si_sgl  := COALESCE(NEW.grade_si_sgl,  NEW.singles_grade);
    NEW.singles_grade  := COALESCE(NEW.singles_grade, NEW.grade_si_sgl);
  ELSE
    -- 갱신: 바뀐 쪽을 원천으로, 다른 쪽에 미러링 (레거시 우선 판정)
    IF NEW.official_grade IS DISTINCT FROM OLD.official_grade THEN
      NEW.grade_si_dbl := NEW.official_grade;
    ELSIF NEW.grade_si_dbl IS DISTINCT FROM OLD.grade_si_dbl THEN
      NEW.official_grade := NEW.grade_si_dbl;
    END IF;

    IF NEW.singles_grade IS DISTINCT FROM OLD.singles_grade THEN
      NEW.grade_si_sgl := NEW.singles_grade;
    ELSIF NEW.grade_si_sgl IS DISTINCT FROM OLD.grade_si_sgl THEN
      NEW.singles_grade := NEW.grade_si_sgl;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_sync_si_grade ON profiles;
CREATE TRIGGER trg_profiles_sync_si_grade
  BEFORE INSERT OR UPDATE OF official_grade, singles_grade, grade_si_dbl, grade_si_sgl
  ON profiles
  FOR EACH ROW EXECUTE FUNCTION bmg_sync_si_grade();


-- ============================================================
-- 3. tournaments.unit + unit→cert_level 자동 매핑 트리거
--    unit: gu(구)/si(시)/nat(전국).  cert_level은 이 매핑으로 자동 채워 010 MMR RPC 재사용.
--      gu→'c'(K32) · si→'b'(K48) · nat→'a'(K64)   (전부 반영, 비반영 none 없음)
-- ============================================================
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'gu';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'tournaments' AND constraint_name = 'chk_tournament_unit'
  ) THEN
    ALTER TABLE tournaments
      ADD CONSTRAINT chk_tournament_unit CHECK (unit IN ('gu','si','nat'));
  END IF;
END
$$;

COMMENT ON COLUMN tournaments.unit IS '대회 단위: gu(구)/si(시)/nat(전국). cert_level·승급 트랙·MMR K를 결정';

-- unit → cert_level 매핑 헬퍼(grades.js unitToCert와 1:1)
CREATE OR REPLACE FUNCTION bmg_unit_to_cert(u text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE u WHEN 'gu' THEN 'c' WHEN 'si' THEN 'b' WHEN 'nat' THEN 'a' ELSE 'c' END
$$;

-- 저장 시 cert_level 자동 세팅: INSERT 항상, UPDATE는 unit이 바뀔 때만(수동 cert 조정 여지 보존)
CREATE OR REPLACE FUNCTION bmg_tournament_cert_from_unit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.cert_level := bmg_unit_to_cert(NEW.unit);
  ELSIF NEW.unit IS DISTINCT FROM OLD.unit THEN
    NEW.cert_level := bmg_unit_to_cert(NEW.unit);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tournaments_cert_from_unit ON tournaments;
CREATE TRIGGER trg_tournaments_cert_from_unit
  BEFORE INSERT OR UPDATE OF unit ON tournaments
  FOR EACH ROW EXECUTE FUNCTION bmg_tournament_cert_from_unit();


-- ============================================================
-- 4. tournament_categories.allowed_grades — 참가 가능 조 목록
--    TEXT[] 조 key 배열. 빈 배열/NULL = 제한 없음. 기존 grade_min/grade_max는 레거시로 유지.
-- ============================================================
ALTER TABLE tournament_categories
  ADD COLUMN IF NOT EXISTS allowed_grades TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN tournament_categories.allowed_grades
  IS '참가 가능 조(왕초심~자강조) 화이트리스트. 빈 배열=제한 없음. grade_min/max는 레거시 폴백';


-- ============================================================
-- 5. grade_history.unit — 승급 원장에 단위 태그 추가
--    NULL = 레거시(012가 쓴 시 트랙 행). v2는 항상 unit을 기록.
-- ============================================================
ALTER TABLE grade_history
  ADD COLUMN IF NOT EXISTS unit TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'grade_history' AND constraint_name = 'chk_grade_history_unit'
  ) THEN
    -- NULL 허용(레거시), 값이 있으면 gu/si/nat만
    ALTER TABLE grade_history
      ADD CONSTRAINT chk_grade_history_unit CHECK (unit IS NULL OR unit IN ('gu','si','nat'));
  END IF;
END
$$;

COMMENT ON COLUMN grade_history.unit IS '승급이 반영된 단위(gu/si/nat). NULL=레거시(시 트랙)';


-- ============================================================
-- 6. unit·mode별 누적 입상 점수 (012 bmg_earned_promo_points의 단위 필터판)
--    같은 종목이라도 구/시/전국 트랙은 "그 단위 대회 입상"으로만 오른다.
--    점수 가중(cert_mult)은 unit→cert 매핑을 그대로 타므로 자연히 구<시<전국.
-- ============================================================
CREATE OR REPLACE FUNCTION bmg_earned_promo_points_unit(p_player uuid, p_mode text, p_unit text)
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
    AND e.final_rank <= COALESCE(c.prize_spots, 3)
    AND t.cert_level IN ('a','b','c')
    AND COALESCE(t.unit,'si') = p_unit
    AND (CASE WHEN c.sport_type IN ('남단','여단') THEN 'singles' ELSE 'doubles' END) = p_mode
$$;
REVOKE ALL ON FUNCTION bmg_earned_promo_points_unit(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bmg_earned_promo_points_unit(uuid, text, text) TO authenticated;


-- ============================================================
-- 7. unit·mode → 트랙 컬럼명 (화이트리스트). 동적 SQL 주입 방지용.
-- ============================================================
CREATE OR REPLACE FUNCTION bmg_grade_column(p_unit text, p_mode text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_unit || ':' || p_mode
           WHEN 'gu:doubles'  THEN 'grade_gu_dbl'
           WHEN 'si:doubles'  THEN 'grade_si_dbl'
           WHEN 'nat:doubles' THEN 'grade_nat_dbl'
           WHEN 'gu:singles'  THEN 'grade_gu_sgl'
           WHEN 'si:singles'  THEN 'grade_si_sgl'
           WHEN 'nat:singles' THEN 'grade_nat_sgl'
           ELSE NULL
         END
$$;


-- ============================================================
-- 8. bmg_eval_promotion_v2 — 선수1·모드1·단위1 승급 판정+반영(내부 전용)
--    012 bmg_eval_promotion의 멱등 설계를 그대로 계승하되:
--      · 현재 급수를 6트랙 컬럼에서 읽고(NULL→왕초심 idx0), 같은 컬럼에 반영.
--      · 자동승급 카운트/점수를 unit으로 필터(시 unit은 레거시 NULL 행도 시로 간주).
--    컬럼은 화이트리스트(bmg_grade_column)로만 선택 → 동적 SQL 안전.
-- ============================================================
CREATE OR REPLACE FUNCTION bmg_eval_promotion_v2(
  p_player uuid, p_mode text, p_unit text, p_tournament uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cfg         grade_promotion_config%ROWTYPE;
  v_col       text;
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

  v_col := bmg_grade_column(p_unit, p_mode);
  IF v_col IS NULL THEN RETURN NULL; END IF;

  -- 현재 급수(행 잠금) — 6트랙 컬럼에서. NULL(미보유)=왕초심 idx0에서 시작.
  EXECUTE format('SELECT %I FROM profiles WHERE id = $1 FOR UPDATE', v_col)
    INTO v_cur_grade USING p_player;
  v_cur_grade := COALESCE(v_cur_grade, '왕초심');
  v_cur_idx   := bmg_grade_idx(v_cur_grade);

  -- 이미 반영된 자동 승급 횟수(이 단위·모드). 시 unit은 레거시 NULL 행도 포함.
  SELECT count(*) INTO v_autos
    FROM grade_history
   WHERE player_id = p_player
     AND game_mode = p_mode
     AND reason = '입상 누적 승급'
     AND (unit = p_unit OR (p_unit = 'si' AND unit IS NULL));

  v_anchor := greatest(0, v_cur_idx - v_autos);
  v_pts    := bmg_earned_promo_points_unit(p_player, p_mode, p_unit);

  -- anchor에서 그리디 상승 (자동 상한 max_auto_grade_idx 까지만)
  v_idx := v_anchor;
  LOOP
    EXIT WHEN v_idx >= cfg.max_auto_grade_idx;
    v_thresh := cfg.threshold_base + cfg.threshold_step * v_idx;
    EXIT WHEN v_pts < v_thresh;
    v_pts := v_pts - v_thresh;
    v_idx := v_idx + 1;
  END LOOP;

  -- 승급 없음(절대 강등 안 함)
  IF v_idx <= v_cur_idx THEN
    RETURN NULL;
  END IF;

  v_target := bmg_grade_at(v_idx);

  -- 트랙 컬럼 반영(시 트랙이면 트리거가 official_grade/singles_grade로 미러링)
  EXECUTE format('UPDATE profiles SET %I = $1 WHERE id = $2', v_col)
    USING v_target, p_player;

  -- 승급 유예/축하배지 타임스탬프(레거시 컬럼) — 시 트랙에서만 의미
  IF p_unit = 'si' THEN
    IF p_mode = 'singles' THEN
      UPDATE profiles SET singles_grade_promoted_at = NOW() WHERE id = p_player;
    ELSE
      UPDATE profiles SET grade_promoted_at = NOW() WHERE id = p_player;
    END IF;
  END IF;

  -- 단계별 원장 기록(단위 태그 포함)
  i := v_cur_idx + 1;
  WHILE i <= v_idx LOOP
    INSERT INTO grade_history
      (player_id, game_mode, unit, from_grade, to_grade, reason, tournament_id, points_snapshot)
    VALUES
      (p_player, p_mode, p_unit, bmg_grade_at(i - 1), bmg_grade_at(i),
       '입상 누적 승급', p_tournament, bmg_earned_promo_points_unit(p_player, p_mode, p_unit));
    i := i + 1;
  END LOOP;

  RETURN v_target;
END;
$$;
REVOKE ALL ON FUNCTION bmg_eval_promotion_v2(uuid, text, text, uuid) FROM PUBLIC;


-- ============================================================
-- 9. promote_grades_v2 — 공개 RPC (SECURITY DEFINER)
--    대회 종료 직후 이 대회 unit의 참가자 전원을 (모드별) 일괄 심사.
--    권한: 이 대회의 주최자만. 멱등: 내부 평가가 멱등.
--    ⚠️ 앱(advance.js finalizeTournament)은 012 promote_grades_for_tournament 대신 이 v2를 호출.
--       (동시 호출 시 시 트랙이 이중 반영될 수 있으므로 둘 중 하나만 부른다 — v2 채택.)
-- ============================================================
CREATE OR REPLACE FUNCTION promote_grades_v2(p_tournament uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org    uuid;
  v_unit   text;
  v_rec    record;
  v_new    text;
  v_result jsonb := '[]'::jsonb;
BEGIN
  SELECT organizer_id, COALESCE(unit,'si') INTO v_org, v_unit
    FROM tournaments WHERE id = p_tournament;
  IF NOT FOUND THEN
    RAISE EXCEPTION '대회를 찾을 수 없습니다: %', p_tournament;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> v_org THEN
    RAISE EXCEPTION '권한이 없습니다: 이 대회의 주최자만 승급 심사를 실행할 수 있습니다';
  END IF;

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
    v_new := bmg_eval_promotion_v2(v_rec.player_id, v_rec.mode, v_unit, p_tournament);
    IF v_new IS NOT NULL THEN
      v_result := v_result || jsonb_build_object(
        'player_id', v_rec.player_id,
        'mode',      v_rec.mode,
        'unit',      v_unit,
        'to_grade',  v_new
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION promote_grades_v2(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION promote_grades_v2(uuid) TO authenticated;


-- ============================================================
-- 10. grade_promotion_progress_v2 — 프로필 프리뷰(단위·모드별 "다음 급수까지")
--     012 grade_promotion_progress의 6트랙판(반영 없음, 읽기 전용).
-- ============================================================
CREATE OR REPLACE FUNCTION grade_promotion_progress_v2(p_player uuid, p_mode text, p_unit text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cfg         grade_promotion_config%ROWTYPE;
  v_col       text;
  v_cur_grade text;
  v_cur_idx   integer;
  v_autos     integer;
  v_anchor    integer;
  v_pts       numeric;
  v_idx       integer;
  v_thresh    numeric;
BEGIN
  SELECT * INTO cfg FROM grade_promotion_config WHERE id = 1;
  v_col := bmg_grade_column(p_unit, p_mode);
  IF v_col IS NULL THEN RETURN NULL; END IF;

  EXECUTE format('SELECT %I FROM profiles WHERE id = $1', v_col)
    INTO v_cur_grade USING p_player;
  v_cur_grade := COALESCE(v_cur_grade, '왕초심');
  v_cur_idx   := bmg_grade_idx(v_cur_grade);

  SELECT count(*) INTO v_autos
    FROM grade_history
   WHERE player_id = p_player AND game_mode = p_mode AND reason = '입상 누적 승급'
     AND (unit = p_unit OR (p_unit = 'si' AND unit IS NULL));

  v_anchor := greatest(0, v_cur_idx - v_autos);
  v_pts    := bmg_earned_promo_points_unit(p_player, p_mode, p_unit);

  v_idx := v_anchor;
  WHILE v_idx < v_cur_idx LOOP
    v_pts := v_pts - (cfg.threshold_base + cfg.threshold_step * v_idx);
    v_idx := v_idx + 1;
  END LOOP;

  IF v_cur_idx >= cfg.max_auto_grade_idx THEN
    RETURN jsonb_build_object(
      'current_grade', v_cur_grade, 'unit', p_unit, 'at_auto_cap', true,
      'next_grade', NULL, 'points', round(greatest(v_pts,0),2),
      'points_needed', NULL, 'remaining', NULL);
  END IF;

  v_thresh := cfg.threshold_base + cfg.threshold_step * v_cur_idx;
  RETURN jsonb_build_object(
    'current_grade', v_cur_grade, 'unit', p_unit, 'at_auto_cap', false,
    'next_grade', bmg_grade_at(v_cur_idx + 1),
    'points', round(greatest(v_pts,0),2),
    'points_needed', v_thresh,
    'remaining', round(greatest(v_thresh - v_pts,0),2));
END;
$$;
REVOKE ALL ON FUNCTION grade_promotion_progress_v2(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grade_promotion_progress_v2(uuid, text, text) TO authenticated;

-- ============================================================
-- 끝. 앱 통합 계약:
--   · CreateTournament: form에 unit(gu/si/nat) 선택 추가 → insert. cert_level은 트리거가 자동.
--   · advance.js finalizeTournament: promote_grades_for_tournament → promote_grades_v2 로 교체.
--     (또는 v2만 호출. 둘 다 호출 금지 — 시 트랙 이중 반영.)
--   · Profile 승급 프리뷰: grade_promotion_progress_v2(p_player, p_mode, p_unit) 사용.
--   · checkEligibility: 대회 unit·mode 트랙 급수를 allowed_grades와 대조(아래 계약 명세).
-- ============================================================
