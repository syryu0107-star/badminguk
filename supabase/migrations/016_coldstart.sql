-- ============================================================
-- 016_coldstart.sql
-- 배드민국 콜드스타트 TOP5 데이터모델 (docs/COLDSTART_STRATEGY.md 3·4·6·7장)
--
-- 목적: 기존 Elo MMR 위에 "신뢰도(RD) 레이어"를 얹어
--   (2) 급수→MMR+RD 밴드, (3) provisional 큰-K 수렴, (4) 신뢰도 뱃지,
--   (5) 자기신고+증빙 온보딩, (1) 주최자 CSV 임포트 이력을 지탱한다.
--
-- ⚠️ 설계 원칙
--   · 완전 Glicko-2 재작성 금지. 기존 apply_match_mmr(010)·급수3축(014)·
--     승급(012)·reliability.js 를 전부 재사용하고 RD 컬럼 1쌍만 추가한다.
--   · reliability.js(신뢰도 0~100%)는 mmr_history에서 "사후 파생"하는 값이고,
--     여기서 추가하는 mmr_rd/singles_mmr_rd는 온보딩 시점에 밴드로 "선험 주입"되어
--     경기가 쌓이기 전 provisional K와 뱃지를 구동하는 상태값이다. 둘은 중복이 아니라
--     역할이 다르다(사전 RD → 경기 누적 → 사후 reliability). rating.js.reliabilityLabel이
--     둘을 이어붙인다(초기=RD, 성숙=reliability score).
--   · 기존 마이그레이션(001~015) 수정 금지. 전부 멱등
--     (IF NOT EXISTS / CREATE OR REPLACE / DO 가드).
--   · 010 apply_match_mmr 은 무수정. RD 반영은 apply_match_mmr_v2(신규)로 처리한다.
--     (택1 명시: "앱단 provisional K"가 아니라 "SQL v2 RPC" 채택 — RD 감쇠가
--      MMR 갱신과 같은 트랜잭션에서 원자적으로 일어나야 하기 때문.)
-- ============================================================


-- ============================================================
-- 1. profiles: RD(불확실성) + 콜드스타트 메타 컬럼
--    · mmr_rd / singles_mmr_rd : 레이팅 편차. 신규 350(최대), 활동 선수 60~110로 수렴.
--    · provisional / singles_provisional : 경기·RD 임계 미달(수렴 전) = true.
--    · mmr_source / singles_mmr_source : 현재 MMR의 출처 추적.
--    reliability.js가 쓰는 mmr_games_played·mmr_history는 그대로. RD는 그 위의 별도 축.
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS mmr_rd              NUMERIC NOT NULL DEFAULT 350,
  ADD COLUMN IF NOT EXISTS singles_mmr_rd      NUMERIC NOT NULL DEFAULT 350,
  ADD COLUMN IF NOT EXISTS provisional         BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS singles_provisional BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS mmr_source          TEXT    NOT NULL DEFAULT 'self_report',
  ADD COLUMN IF NOT EXISTS singles_mmr_source  TEXT    NOT NULL DEFAULT 'self_report';

COMMENT ON COLUMN profiles.mmr_rd             IS '복식 MMR 레이팅편차(불확실성). 신규 350, 수렴 시 60~110. provisional K·신뢰도 뱃지 구동';
COMMENT ON COLUMN profiles.singles_mmr_rd     IS '단식 MMR 레이팅편차. mmr_rd와 동일 규칙';
COMMENT ON COLUMN profiles.provisional        IS '복식 MMR 잠정(수렴 전) 여부. RD>110 또는 경기<5면 true. 리더보드 잠정표시·큰K 구동';
COMMENT ON COLUMN profiles.singles_provisional IS '단식 MMR 잠정 여부';
COMMENT ON COLUMN profiles.mmr_source         IS '복식 MMR 출처: self_report(온보딩밴드)|import(대회임포트)|match(자체경기). 신뢰가중·감사용';
COMMENT ON COLUMN profiles.singles_mmr_source IS '단식 MMR 출처';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
     WHERE table_name='profiles' AND constraint_name='chk_mmr_source') THEN
    ALTER TABLE profiles ADD CONSTRAINT chk_mmr_source
      CHECK (mmr_source IN ('self_report','import','match'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
     WHERE table_name='profiles' AND constraint_name='chk_singles_mmr_source') THEN
    ALTER TABLE profiles ADD CONSTRAINT chk_singles_mmr_source
      CHECK (singles_mmr_source IN ('self_report','import','match'));
  END IF;
END $$;


-- ============================================================
-- 2. profiles: 온보딩 자기신고 "예측 변수" 컬럼 (전략 3-2)
--    본인 급수 감(感)이 아니라 검증 가능한 사실을 저장 → surveyToRating 입력.
--    ⚠️ 중복 회피: 증빙 이미지·검증여부는 001의 grade_proof_url / grade_verified 재사용.
--       (evidence_url 신설 안 함 — grade_proof_url이 곧 증빙 캡처 URL.)
--       official_grade(=유효 급수, 승급으로 변동)와 별도로 self_reported_grade는
--       "온보딩 원본 신고값"을 불변 보존해 샌드배깅 교차검증 기준으로 쓴다.
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS career_months       INTEGER,          -- 구력(개월). NULL=미응답
  ADD COLUMN IF NOT EXISTS is_elite            BOOLEAN NOT NULL DEFAULT false, -- 선수부(초/중/고/대/실업) 출신
  ADD COLUMN IF NOT EXISTS club_name           TEXT,             -- 소속 클럽(운영진 교차검증 대상)
  ADD COLUMN IF NOT EXISTS self_reported_grade TEXT,             -- 온보딩 원본 신고 급수(불변). 교차검증 기준
  ADD COLUMN IF NOT EXISTS weekly_sessions     INTEGER,          -- 주 운동 횟수(보조 신호)
  ADD COLUMN IF NOT EXISTS onboarding_done     BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN profiles.career_months       IS '구력(레슨 시작 이후 개월). 급수 하한 추정. NULL=미응답';
COMMENT ON COLUMN profiles.is_elite            IS '선수부 출신 여부. 자강권 강력 신호';
COMMENT ON COLUMN profiles.club_name           IS '소속 클럽명. 운영진 교차검증·국소 유동성 클러스터링';
COMMENT ON COLUMN profiles.self_reported_grade IS '온보딩 시 본인이 신고한 급수(원본, 불변). official_grade와 달리 승급으로 안 바뀜 → crossCheckSandbag 기준';
COMMENT ON COLUMN profiles.weekly_sessions     IS '주 운동 횟수. RD 보조 축소 신호';
COMMENT ON COLUMN profiles.onboarding_done     IS '온보딩 설문 완료 여부';


-- ============================================================
-- 3. RD 헬퍼 — rating.js 상수와 1:1 (SQL 정본)
-- ============================================================

-- provisionalK(rd, games) — 큰-K 배수 [1.0, 3.0]. RD 높거나 경기<5면 크게.
-- rating.js provisionalK와 동일 공식.
CREATE OR REPLACE FUNCTION bmg_provisional_k_mult(p_rd numeric, p_games integer)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT GREATEST(
    CASE WHEN COALESCE(p_games,0) < 5 THEN 1.5 ELSE 1.0 END,
    1.0 + (LEAST(GREATEST(COALESCE(p_rd,350), 60), 350) - 60) / (350.0 - 60.0) * (3.0 - 1.0)
  )
$$;

-- 경기 1건 후 RD 축소(수렴). 활동 바닥값 60. rating.js decayRD와 동일.
CREATE OR REPLACE FUNCTION bmg_decay_rd(p_rd numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT GREATEST(60, ROUND(COALESCE(p_rd,350) * 0.92, 1))
$$;


-- ============================================================
-- 4. bmg_apply_player_v2 — RD 반영판 선수 1명 갱신
--    010 bmg_apply_player을 무수정 재사용하지 못하는 이유: K가 함수 내부에서
--    games<10→1.5로 고정. v2는 base_k에 provisional 배수(RD 연속값)를 곱하고
--    갱신 후 RD를 감쇠·provisional·source를 함께 기록한다.
--    나머지 Elo 수식(expected·partner_adj·js_round·cert_k)은 010 헬퍼 그대로 호출.
--    바닥값(floor)=700: 초보 무한패배 루프 방지(전략 3-3 규칙①). 010은 100.
-- ============================================================
CREATE OR REPLACE FUNCTION bmg_apply_player_v2(
  p_player      uuid,
  p_mmr         integer,
  p_games       integer,
  p_rd          numeric,
  p_partner_mmr integer,
  p_opp_avg     double precision,
  p_result      integer,
  p_cert        text,
  p_mode        text,
  p_tournament  uuid,
  p_match       uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_base_k     integer;
  v_mult       double precision;
  v_e          double precision;
  v_delta_base integer;
  v_adj        double precision;
  v_delta      integer;
  v_after      integer;
  v_adj_pct    integer;
  v_rd_new     numeric;
  v_prov       boolean;
BEGIN
  v_base_k := bmg_cert_k(p_cert);
  IF v_base_k = 0 THEN
    v_delta_base := 0;
  ELSE
    v_mult       := bmg_provisional_k_mult(p_rd, p_games);   -- RD 연속 큰-K
    v_e          := bmg_expected(p_mmr, p_opp_avg);
    v_delta_base := bmg_js_round(v_base_k * v_mult * (p_result - v_e));
  END IF;

  IF p_partner_mmr IS NULL THEN
    v_adj := 1.0;
  ELSE
    v_adj := bmg_partner_adj(p_mmr, p_partner_mmr);
  END IF;

  v_delta   := bmg_js_round(v_delta_base * v_adj);
  v_after   := greatest(700, p_mmr + v_delta);                -- 콜드스타트 바닥값
  v_adj_pct := bmg_js_round((v_adj - 1.0) * 100);
  v_rd_new  := bmg_decay_rd(p_rd);
  v_prov    := (v_rd_new > 110) OR ((COALESCE(p_games,0) + 1) < 5);

  IF p_mode = 'singles' THEN
    UPDATE profiles
       SET singles_mmr          = v_after,
           singles_games_played = p_games + 1,
           singles_mmr_rd       = v_rd_new,
           singles_provisional  = v_prov,
           singles_mmr_source   = 'match'
     WHERE id = p_player;
  ELSE
    UPDATE profiles
       SET mmr              = v_after,
           mmr_games_played = p_games + 1,
           mmr_rd           = v_rd_new,
           provisional      = v_prov,
           mmr_source       = 'match'
     WHERE id = p_player;
  END IF;

  INSERT INTO mmr_history
    (player_id, tournament_id, match_id, mmr_before, mmr_after, delta, cert_level, partner_adj, game_mode)
  VALUES
    (p_player, p_tournament, p_match, p_mmr, v_after, v_delta, p_cert, v_adj_pct, p_mode);
END;
$$;


-- ============================================================
-- 5. apply_match_mmr_v2(p_match_id) — RD 반영판 공개 RPC
--    010 apply_match_mmr의 3.1~3.9 흐름을 1:1로 복제하되, 선수 갱신만
--    bmg_apply_player_v2로 바꾸고 경기 전 RD(mmr_rd/singles_mmr_rd)를 함께 읽는다.
--    권한·멱등·walkover·bye·none 스킵 규칙 동일.
--    ⚠️ 앱(advance.js finalize)은 apply_match_mmr 대신 이 v2만 호출(둘 다 호출 금지).
-- ============================================================
CREATE OR REPLACE FUNCTION apply_match_mmr_v2(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match      tournament_matches%ROWTYPE;
  v_org        uuid;
  v_tournament uuid;
  v_cert       text;
  v_t1e        tournament_entries%ROWTYPE;
  v_t2e        tournament_entries%ROWTYPE;
  v_doubles    boolean;
  v_wside      integer;
  v_r1         integer;
  v_r2         integer;
  v_a_mmr integer; v_a_games integer; v_a_rd numeric;
  v_b_mmr integer; v_b_games integer; v_b_rd numeric;
  v_c_mmr integer; v_c_games integer; v_c_rd numeric;
  v_d_mmr integer; v_d_games integer; v_d_rd numeric;
  v_t1avg double precision;
  v_t2avg double precision;
BEGIN
  SELECT * INTO v_match FROM tournament_matches WHERE id = p_match_id;
  IF NOT FOUND THEN RAISE EXCEPTION '경기를 찾을 수 없습니다: %', p_match_id; END IF;

  SELECT t.id, t.organizer_id, t.cert_level
    INTO v_tournament, v_org, v_cert
    FROM tournament_categories tc
    JOIN tournaments t ON t.id = tc.tournament_id
   WHERE tc.id = v_match.category_id;

  IF auth.uid() IS NULL OR auth.uid() <> v_org THEN
    RAISE EXCEPTION '권한이 없습니다: 이 대회의 주최자만 MMR을 반영할 수 있습니다';
  END IF;

  IF v_match.mmr_applied THEN RETURN; END IF;

  IF v_match.result_type = 'walkover' THEN
    UPDATE tournament_matches SET mmr_applied = true WHERE id = p_match_id; RETURN;
  END IF;

  IF v_match.winner_entry_id IS NULL
     OR v_match.team1_entry_id IS NULL
     OR v_match.team2_entry_id IS NULL THEN
    UPDATE tournament_matches SET mmr_applied = true WHERE id = p_match_id; RETURN;
  END IF;

  IF v_cert IS NULL OR bmg_cert_k(v_cert) = 0 THEN
    UPDATE tournament_matches SET mmr_applied = true WHERE id = p_match_id; RETURN;
  END IF;

  SELECT * INTO v_t1e FROM tournament_entries WHERE id = v_match.team1_entry_id;
  SELECT * INTO v_t2e FROM tournament_entries WHERE id = v_match.team2_entry_id;

  v_doubles := (v_t1e.player2_id IS NOT NULL AND v_t2e.player2_id IS NOT NULL);
  v_wside := CASE WHEN v_match.winner_entry_id = v_match.team1_entry_id THEN 1 ELSE 2 END;
  v_r1    := CASE WHEN v_wside = 1 THEN 1 ELSE 0 END;
  v_r2    := 1 - v_r1;

  IF v_doubles THEN
    SELECT mmr, mmr_games_played, mmr_rd INTO v_a_mmr, v_a_games, v_a_rd
      FROM profiles WHERE id = v_t1e.player1_id FOR UPDATE;
    SELECT mmr, mmr_games_played, mmr_rd INTO v_b_mmr, v_b_games, v_b_rd
      FROM profiles WHERE id = v_t1e.player2_id FOR UPDATE;
    SELECT mmr, mmr_games_played, mmr_rd INTO v_c_mmr, v_c_games, v_c_rd
      FROM profiles WHERE id = v_t2e.player1_id FOR UPDATE;
    SELECT mmr, mmr_games_played, mmr_rd INTO v_d_mmr, v_d_games, v_d_rd
      FROM profiles WHERE id = v_t2e.player2_id FOR UPDATE;

    v_t1avg := bmg_js_round((v_a_mmr + v_b_mmr) / 2.0);
    v_t2avg := bmg_js_round((v_c_mmr + v_d_mmr) / 2.0);

    PERFORM bmg_apply_player_v2(v_t1e.player1_id, v_a_mmr, v_a_games, v_a_rd, v_b_mmr, v_t2avg, v_r1, v_cert, 'doubles', v_tournament, p_match_id);
    PERFORM bmg_apply_player_v2(v_t1e.player2_id, v_b_mmr, v_b_games, v_b_rd, v_a_mmr, v_t2avg, v_r1, v_cert, 'doubles', v_tournament, p_match_id);
    PERFORM bmg_apply_player_v2(v_t2e.player1_id, v_c_mmr, v_c_games, v_c_rd, v_d_mmr, v_t1avg, v_r2, v_cert, 'doubles', v_tournament, p_match_id);
    PERFORM bmg_apply_player_v2(v_t2e.player2_id, v_d_mmr, v_d_games, v_d_rd, v_c_mmr, v_t1avg, v_r2, v_cert, 'doubles', v_tournament, p_match_id);
  ELSE
    SELECT singles_mmr, singles_games_played, singles_mmr_rd INTO v_a_mmr, v_a_games, v_a_rd
      FROM profiles WHERE id = v_t1e.player1_id FOR UPDATE;
    SELECT singles_mmr, singles_games_played, singles_mmr_rd INTO v_c_mmr, v_c_games, v_c_rd
      FROM profiles WHERE id = v_t2e.player1_id FOR UPDATE;

    PERFORM bmg_apply_player_v2(v_t1e.player1_id, v_a_mmr, v_a_games, v_a_rd, NULL, v_c_mmr::double precision, v_r1, v_cert, 'singles', v_tournament, p_match_id);
    PERFORM bmg_apply_player_v2(v_t2e.player1_id, v_c_mmr, v_c_games, v_c_rd, NULL, v_a_mmr::double precision, v_r2, v_cert, 'singles', v_tournament, p_match_id);
  END IF;

  UPDATE tournament_matches SET mmr_applied = true WHERE id = p_match_id;
END;
$$;
REVOKE ALL ON FUNCTION apply_match_mmr_v2(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_match_mmr_v2(uuid) TO authenticated;


-- ============================================================
-- 6. imported_results — 주최자 CSV 임포트 이력 대장 (전략 6-2, TOP5-#1)
--    "주최자 1명 업로드 = 참가자 수십명 온보딩"의 감사·되돌리기 앵커.
--    행 단위 원천은 별도 staging(v2)로 미루고, 여기선 배치 헤더만 기록.
-- ============================================================
CREATE TABLE IF NOT EXISTS imported_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,  -- NULL=외부(과거) 대회 결과
  uploaded_by   UUID NOT NULL REFERENCES profiles(id),
  source        TEXT NOT NULL DEFAULT 'csv',   -- csv | ocr | manual | self_capture
  file_name     TEXT,
  row_count     INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,    -- 기존 프로필 병합 수
  created_count INTEGER NOT NULL DEFAULT 0,    -- 신규 생성 수
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | merged | reverted
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_import_source CHECK (source IN ('csv','ocr','manual','self_capture')),
  CONSTRAINT chk_import_status CHECK (status IN ('pending','merged','reverted'))
);

CREATE INDEX IF NOT EXISTS idx_imported_results_tournament ON imported_results(tournament_id);
CREATE INDEX IF NOT EXISTS idx_imported_results_uploader   ON imported_results(uploaded_by, created_at DESC);

COMMENT ON TABLE  imported_results IS '주최자 대회결과 일괄 임포트 이력(대장). 감사·되돌리기·닭달걀 지렛대 추적';
COMMENT ON COLUMN imported_results.tournament_id IS '연결 대회. NULL=배드민국에 대회row 없는 순수 외부/과거 결과';
COMMENT ON COLUMN imported_results.source        IS '출처: csv|ocr|manual|self_capture. 신뢰가중 차등(주최자csv>self_capture)';

ALTER TABLE imported_results ENABLE ROW LEVEL SECURITY;

-- SELECT: 업로더 본인 또는 해당 대회 주최자
DROP POLICY IF EXISTS "임포트 조회" ON imported_results;
CREATE POLICY "임포트 조회" ON imported_results FOR SELECT
  USING (
    auth.uid() = uploaded_by
    OR auth.uid() = (SELECT organizer_id FROM tournaments WHERE id = tournament_id)
  );

-- INSERT: 본인 업로드로만. 대회 연결 시 그 대회 주최자여야 함.
DROP POLICY IF EXISTS "임포트 등록" ON imported_results;
CREATE POLICY "임포트 등록" ON imported_results FOR INSERT
  WITH CHECK (
    auth.uid() = uploaded_by
    AND (
      tournament_id IS NULL
      OR auth.uid() = (SELECT organizer_id FROM tournaments WHERE id = tournament_id)
    )
  );

-- UPDATE(status: merged/reverted): 업로더 또는 주최자
DROP POLICY IF EXISTS "임포트 수정" ON imported_results;
CREATE POLICY "임포트 수정" ON imported_results FOR UPDATE
  USING (
    auth.uid() = uploaded_by
    OR auth.uid() = (SELECT organizer_id FROM tournaments WHERE id = tournament_id)
  );


-- ============================================================
-- 7. 기존 행 백필 — provisional/RD 정합화 (멱등, 이미 채워진 행은 건드리지 않음)
--    · 경기 5+ 이면 provisional=false, RD를 활동 수준(110)으로 근사 하강.
--    · self_reported_grade 비면 현재 official_grade로 시드(원본 대용).
-- ============================================================
UPDATE profiles
   SET mmr_rd = LEAST(mmr_rd, 110), provisional = false
 WHERE mmr_games_played >= 5 AND provisional = true;

UPDATE profiles
   SET singles_mmr_rd = LEAST(singles_mmr_rd, 110), singles_provisional = false
 WHERE singles_games_played >= 5 AND singles_provisional = true;

UPDATE profiles
   SET self_reported_grade = official_grade
 WHERE self_reported_grade IS NULL AND official_grade IS NOT NULL;


-- ============================================================
-- 끝. 앱 통합 계약
--   · advance.js finalize: apply_match_mmr → apply_match_mmr_v2 로 교체(둘 다 호출 금지).
--   · Onboarding.jsx: 설문(career_months·is_elite·club_name·self_reported_grade·
--     weekly_sessions) 수집 → src/lib/rating.js.surveyToRating → profiles.upsert
--     (mmr/singles_mmr, mmr_rd/singles_mmr_rd, mmr_source='self_report',
--      provisional=true, onboarding_done=true). 증빙은 grade_proof_url(001) 재사용.
--   · CSV 임포터: imported_results INSERT + 참가자 profiles upsert
--     (mmr_source='import', RD=밴드값). row 매칭은 앱단.
--   · 표시(Profile/Ranking/Home): rating.js.reliabilityLabel(rd, games[, relScore])로
--     '측정 중'/'검증완료' 뱃지. 성숙 구간은 reliability.js.calcReliability 유지.
-- ============================================================
