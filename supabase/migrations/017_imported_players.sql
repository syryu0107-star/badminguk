-- ============================================================
-- 017_imported_players.sql
-- 배드민국 "아직 가입 안 한 선수" 명단 + 가입 시 이어받기(claim)
-- (docs/COLDSTART_STRATEGY.md 6장 — 주최자 CSV 업로드로 미가입 선수까지 온보딩)
--
-- 목적:
--   · 016 imported_results(임포트 대장) 아래에, CSV로 올라온 개별 참가자 중
--     "아직 배드민국 계정이 없는 선수"를 별도 테이블(imported_players)에 담는다.
--   · 랭킹/전적에는 실명 마스킹(홍*동)으로 노출(공개 SELECT + 앱 마스킹).
--   · 본인이 가입하면 claim RPC로 그 기록을 자기 프로필(6트랙 급수 + MMR/RD)로 이관.
--
-- ⚠️ 절대 원칙 (이 마이그레이션이 지키는 경계):
--   · profiles 구조·인증(auth.users FK·RLS auth.uid()=id)은 건드리지 않는다.
--     미가입 선수는 auth.users가 없으므로 profiles에 넣을 수 없다 → 별도 테이블.
--   · 001~016 수정 금지. 전부 멱등(IF NOT EXISTS / CREATE OR REPLACE / DROP..IF EXISTS).
--   · 초기 MMR·RD 단일 소스는 rating.js.gradeToMMR. 여기 bmg_grade_to_mmr/_rd 헬퍼는
--     그 공식(급수 중앙앵커 + 단위보정 + 바닥700/클램프60~350)의 SQL 파리티다.
--   · 타인 실명(PII) 저장 → 공개 표시는 마스킹, INSERT/UPDATE는 RPC(주최자·본인)로만.
-- ============================================================


-- ============================================================
-- 1. 급수 → MMR + RD 밴드 (rating.js.gradeToMMR SQL 파리티)
--    idx·조 매핑은 012 bmg_grade_idx/bmg_grade_at 재사용.
--    center MMR: grades.js GRADES.initialMMR (800~2000).
--    base RD   : rating.js GRADE_RD [350,340,320,300,280,255,230,205].
--    단위 보정 : rating.js UNIT_ADJ (gu −60/+25, si 0/0, nat +80/−20).
-- ============================================================

-- 조 → 중앙 MMR 앵커 (grades.js getInitialMMR 파리티)
CREATE OR REPLACE FUNCTION bmg_grade_center_mmr(p_grade text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE bmg_grade_idx(p_grade)
           WHEN 0 THEN 800  WHEN 1 THEN 1000 WHEN 2 THEN 1100 WHEN 3 THEN 1250
           WHEN 4 THEN 1400 WHEN 5 THEN 1600 WHEN 6 THEN 1800 ELSE 2000
         END
$$;

-- 조 → 기준 RD (rating.js GRADE_RD 파리티)
CREATE OR REPLACE FUNCTION bmg_grade_base_rd(p_grade text)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE bmg_grade_idx(p_grade)
           WHEN 0 THEN 350 WHEN 1 THEN 340 WHEN 2 THEN 320 WHEN 3 THEN 300
           WHEN 4 THEN 280 WHEN 5 THEN 255 WHEN 6 THEN 230 ELSE 205
         END
$$;

-- 급수(조) + 단위 → 초기 MMR. 바닥값 700(전략 3-3 규칙①), round는 정수앵커라 항등.
CREATE OR REPLACE FUNCTION bmg_grade_to_mmr(p_grade text, p_unit text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT GREATEST(700,
           bmg_grade_center_mmr(p_grade)
           + CASE p_unit WHEN 'gu' THEN -60 WHEN 'nat' THEN 80 ELSE 0 END
         )::integer
$$;

-- 급수(조) + 단위 → 초기 RD. clamp(60, 350).
CREATE OR REPLACE FUNCTION bmg_grade_to_rd(p_grade text, p_unit text)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT LEAST(350, GREATEST(60,
           bmg_grade_base_rd(p_grade)
           + CASE p_unit WHEN 'gu' THEN 25 WHEN 'nat' THEN -20 ELSE 0 END
         ))
$$;


-- ============================================================
-- 2. 실명 마스킹 헬퍼 — 홍길동 → 홍*동 (공개 표시 방어선)
--    앱이 표시할 때도 마스킹하지만, DB 뷰에서도 name_masked를 제공해
--    실명이 새어나갈 경로를 하나 더 줄인다.
-- ============================================================
CREATE OR REPLACE FUNCTION bmg_mask_name(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_name IS NULL OR length(btrim(p_name)) = 0 THEN ''
    WHEN length(btrim(p_name)) = 1 THEN btrim(p_name)
    WHEN length(btrim(p_name)) = 2 THEN left(btrim(p_name),1) || '*'
    ELSE left(btrim(p_name),1) || repeat('*', length(btrim(p_name)) - 2) || right(btrim(p_name),1)
  END
$$;


-- ============================================================
-- 3. imported_players — 미가입 선수 명단
--    한 행 = "어떤 대회에서 관측된 미가입 선수 1명(종목 기준)".
--    claimed_by NULL = 아직 아무도 이어받지 않음(랭킹에 마스킹 노출 대상).
-- ============================================================
CREATE TABLE IF NOT EXISTS imported_players (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,                       -- 실명(PII) — 표시 시 마스킹
  gender               TEXT,                                -- 남/여 (선택)
  unit                 TEXT NOT NULL DEFAULT 'gu',          -- gu/si/nat (급수 트랙 축)
  mode                 TEXT NOT NULL DEFAULT 'doubles',     -- singles/doubles
  grade                TEXT,                                -- 조(왕초심~자강조). NULL=미상
  mmr                  INTEGER NOT NULL DEFAULT 1000,       -- 급수→초기 MMR (bmg_grade_to_mmr)
  mmr_rd               NUMERIC NOT NULL DEFAULT 350,        -- 급수→초기 RD  (bmg_grade_to_rd)
  source               TEXT NOT NULL DEFAULT 'import',      -- import|manual|self_capture
  source_tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL, -- NULL=외부/과거 대회
  source_import_id     UUID REFERENCES imported_results(id) ON DELETE SET NULL, -- 대장(016) 연결
  source_label         TEXT,                                -- 대회명 등 표시 라벨
  uploaded_by          UUID NOT NULL REFERENCES profiles(id), -- 등록한 주최자
  claimed_by           UUID REFERENCES profiles(id),        -- 이어받은 회원(NULL=미claim)
  claimed_at           TIMESTAMPTZ,                         -- claim 시각
  phone_hint           TEXT,                                -- claim 매칭 힌트(있으면). 없어도 됨
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_imported_players_unit   CHECK (unit IN ('gu','si','nat')),
  CONSTRAINT chk_imported_players_mode   CHECK (mode IN ('singles','doubles')),
  CONSTRAINT chk_imported_players_source CHECK (source IN ('import','manual','self_capture'))
);

COMMENT ON TABLE  imported_players IS '아직 가입 안 한 선수 명단. 주최자 CSV로 시드, 랭킹에 마스킹 노출, 가입 시 claim으로 프로필 이관';
COMMENT ON COLUMN imported_players.name        IS '실명(타인 PII). 공개 표시는 bmg_mask_name/앱 마스킹. claim 후보 검색에만 원문 사용';
COMMENT ON COLUMN imported_players.grade       IS '조(왕초심~자강조). mmr/mmr_rd는 이 조+unit로 bmg_grade_to_mmr/_rd 산정';
COMMENT ON COLUMN imported_players.claimed_by  IS '이 명단을 이어받은 회원 profile id. NULL=미claim(랭킹 노출 대상)';
COMMENT ON COLUMN imported_players.phone_hint  IS 'claim 자동 매칭용 전화 힌트(선택). 강제 아님';

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_imported_players_name       ON imported_players (lower(name));
CREATE INDEX IF NOT EXISTS idx_imported_players_open       ON imported_players (mmr DESC) WHERE claimed_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_imported_players_tournament ON imported_players (source_tournament_id);
CREATE INDEX IF NOT EXISTS idx_imported_players_uploader   ON imported_players (uploaded_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_imported_players_claimed    ON imported_players (claimed_by);

-- 중복 방지: 같은 대회 · 같은 이름 · 같은 종목 1행 (외부/과거 대회=NULL은 대상 제외)
CREATE UNIQUE INDEX IF NOT EXISTS uq_imported_players_dedup
  ON imported_players (source_tournament_id, lower(name), mode)
  WHERE source_tournament_id IS NOT NULL;


-- ============================================================
-- 4. RLS
--    · SELECT: 공개(랭킹 표시용). 실명 마스킹은 앱/뷰가 담당.
--    · INSERT: 인증된 주최자만(uploaded_by=본인 + 대회 주최자). 정상 경로는 아래 RPC.
--    · UPDATE: 정책 없음 → 직접 수정 차단. claim은 SECURITY DEFINER RPC로만.
-- ============================================================
ALTER TABLE imported_players ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "미가입선수 조회" ON imported_players;
CREATE POLICY "미가입선수 조회" ON imported_players FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "미가입선수 등록" ON imported_players;
CREATE POLICY "미가입선수 등록" ON imported_players FOR INSERT
  WITH CHECK (
    auth.uid() = uploaded_by
    AND (
      source_tournament_id IS NULL
      OR auth.uid() = (SELECT organizer_id FROM tournaments WHERE id = source_tournament_id)
    )
  );
-- UPDATE/DELETE 정책 없음: 직접 변경 불가. claim/정정은 RPC(정의자 권한) 경유.


-- ============================================================
-- 5. bmg_import_participants — 주최자 CSV 파싱결과 → 명단 일괄 INSERT
--    프론트(ImportResults.jsx)가 이미 호출하는 시그니처에 맞춤:
--      supabase.rpc('bmg_import_participants', { p_import_id, p_unit, p_rows })
--    · p_import_id : 016 imported_results(대장) 행 id → 대회·업로더·라벨 도출·권한검증.
--    · p_unit      : 대회 단위(gu/si/nat) → 급수→MMR/RD 보정.
--    · p_rows      : planToSeedRows(importCsv.js) 산출 jsonb 배열
--                    [{ name, gender, grade, mode, rank, draw_size, mmr, rd, match_id, is_new }]
--    미가입(is_new=true / match_id 없음) 행만 명단에 담는다. 초기 MMR/RD는 클라이언트
--    값 불신 → SQL 헬퍼로 재산정. 중복(같은 대회·이름·종목)은 ON CONFLICT로 무시(멱등).
-- ============================================================
CREATE OR REPLACE FUNCTION bmg_import_participants(p_import_id uuid, p_unit text, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uploader   uuid;
  v_tournament uuid;
  v_org        uuid;
  v_label      text;
  v_unit       text := COALESCE(NULLIF(p_unit, ''), 'gu');
  v_row        jsonb;
  v_is_new     boolean;
  v_name       text;
  v_grade      text;
  v_mode       text;
  v_gender     text;
  v_phone      text;
  v_mmr        integer;
  v_rd         numeric;
  v_created    integer := 0;
  v_matched    integer := 0;   -- 기존 프로필 매칭행(명단 대상 아님, 참고용)
  v_skipped    integer := 0;   -- 형식오류/중복으로 제외
BEGIN
  IF v_unit NOT IN ('gu','si','nat') THEN v_unit := 'gu'; END IF;

  -- 1) 대장(ledger)에서 대회·업로더·라벨 도출 + 권한검증
  SELECT ir.uploaded_by, ir.tournament_id, t.title, t.organizer_id
    INTO v_uploader, v_tournament, v_label, v_org
    FROM imported_results ir
    LEFT JOIN tournaments t ON t.id = ir.tournament_id
   WHERE ir.id = p_import_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '임포트 기록(대장)을 찾을 수 없습니다: %', p_import_id;
  END IF;

  IF auth.uid() IS NULL
     OR (auth.uid() <> v_uploader AND (v_org IS NULL OR auth.uid() <> v_org)) THEN
    RAISE EXCEPTION '권한이 없습니다: 업로더 또는 대회 주최자만 참가자를 등록할 수 있습니다';
  END IF;

  -- 2) 행 순회 — 미가입(is_new)만 명단에 담는다
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    -- is_new 우선, 없으면 match_id 부재로 판정
    v_is_new := COALESCE((v_row->>'is_new')::boolean, (v_row->>'match_id') IS NULL);
    IF NOT v_is_new THEN
      v_matched := v_matched + 1;   -- 기존 프로필 존재 → 명단 대상 아님
      CONTINUE;
    END IF;

    v_name  := NULLIF(btrim(v_row->>'name'), '');
    v_grade := NULLIF(btrim(v_row->>'grade'), '');
    IF v_name IS NULL OR v_grade IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_mode   := CASE WHEN (v_row->>'mode') = 'singles' THEN 'singles' ELSE 'doubles' END;
    v_gender := NULLIF(btrim(v_row->>'gender'), '');
    v_phone  := NULLIF(btrim(v_row->>'phone'), '');
    -- 초기 레이팅: SQL 헬퍼(rating.gradeToMMR 파리티)로 재산정
    v_mmr    := bmg_grade_to_mmr(v_grade, v_unit);
    v_rd     := bmg_grade_to_rd(v_grade, v_unit);

    INSERT INTO imported_players
      (name, gender, unit, mode, grade, mmr, mmr_rd, source,
       source_tournament_id, source_import_id, source_label, uploaded_by, phone_hint)
    VALUES
      (v_name, v_gender, v_unit, v_mode, v_grade, v_mmr, v_rd, 'import',
       v_tournament, p_import_id, v_label, v_uploader, v_phone)
    ON CONFLICT (source_tournament_id, lower(name), mode)
      WHERE source_tournament_id IS NOT NULL
      DO NOTHING;

    IF FOUND THEN v_created := v_created + 1;
    ELSE           v_skipped := v_skipped + 1;   -- 중복행
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'created', v_created,   -- 명단에 새로 담긴 미가입 선수 수
    'matched', v_matched,   -- 기존 프로필 매칭행(별도 처리 대상)
    'skipped', v_skipped    -- 형식오류/중복 제외
  );
END;
$$;
REVOKE ALL ON FUNCTION bmg_import_participants(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bmg_import_participants(uuid, text, jsonb) TO authenticated;


-- ============================================================
-- 6. claim_imported_player — 가입한 본인이 명단 1행을 이어받기
--    호출자(auth.uid())가 자기 프로필로 imported_players 행을 claim한다.
--      · 급수(조): 해당 unit·mode 6트랙 컬럼에 상향만 반영(하향 없음).
--      · MMR : GREATEST(현재, 명단) — 상향만.
--      · RD  : LEAST(현재, 명단)   — 하향만(더 확실해질 때만).
--      · provisional: (RD>110) OR (현재 경기<5) 로 재계산. 경기수는 증가시키지 않음.
--      · mmr_source: 명단 MMR을 실제 채택(상향)했을 때만 'import'로 표기.
--    멱등: 이미 claimed면 (본인=성공 no-op / 타인=거부).
--    ⚠️ profiles 컬럼은 6트랙 화이트리스트(bmg_grade_column) + 고정 컬럼명만 사용 → SQL 주입 없음.
-- ============================================================
CREATE OR REPLACE FUNCTION claim_imported_player(p_imported_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_ip         imported_players%ROWTYPE;
  v_col        text;      -- 6트랙 급수 컬럼
  v_mmr_col    text;
  v_rd_col     text;
  v_prov_col   text;
  v_src_col    text;
  v_games_col  text;
  v_cur_grade  text;
  v_cur_mmr    integer;
  v_cur_rd     numeric;
  v_cur_games  integer;
  v_cur_source text;
  v_cur_idx    integer;
  v_imp_idx    integer;
  v_grade_applied text := NULL;
  v_new_mmr    integer;
  v_new_rd     numeric;
  v_new_source text;
  v_prov       boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;

  SELECT * INTO v_ip FROM imported_players WHERE id = p_imported_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '명단을 찾을 수 없습니다: %', p_imported_id; END IF;

  -- 멱등/중복 방지
  IF v_ip.claimed_by IS NOT NULL THEN
    IF v_ip.claimed_by = v_uid THEN
      RETURN jsonb_build_object('ok', true, 'already', true, 'imported_id', p_imported_id);
    END IF;
    RAISE EXCEPTION '이미 다른 회원이 이어받은 기록입니다';
  END IF;

  -- 트랙/컬럼 결정
  v_col := bmg_grade_column(v_ip.unit, v_ip.mode);
  IF v_ip.mode = 'singles' THEN
    v_mmr_col := 'singles_mmr';   v_rd_col := 'singles_mmr_rd';
    v_prov_col := 'singles_provisional'; v_src_col := 'singles_mmr_source';
    v_games_col := 'singles_games_played';
  ELSE
    v_mmr_col := 'mmr';           v_rd_col := 'mmr_rd';
    v_prov_col := 'provisional';  v_src_col := 'mmr_source';
    v_games_col := 'mmr_games_played';
  END IF;

  -- 현재 프로필 값(행 잠금)
  EXECUTE format(
    'SELECT %I, %I, %I, %I, %I FROM profiles WHERE id = $1 FOR UPDATE',
    v_mmr_col, v_rd_col, v_games_col, v_src_col, v_col)
    INTO v_cur_mmr, v_cur_rd, v_cur_games, v_cur_source, v_cur_grade
    USING v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION '프로필이 없습니다. 온보딩을 먼저 완료하세요';
  END IF;

  -- 급수 이관: 상향만
  v_cur_idx := bmg_grade_idx(COALESCE(v_cur_grade, '왕초심'));
  v_imp_idx := bmg_grade_idx(COALESCE(v_ip.grade, '왕초심'));
  IF v_ip.grade IS NOT NULL AND v_col IS NOT NULL AND v_imp_idx > v_cur_idx THEN
    EXECUTE format('UPDATE profiles SET %I = $1 WHERE id = $2', v_col)
      USING v_ip.grade, v_uid;   -- 시 트랙이면 014 트리거가 official/singles_grade로 미러링
    v_grade_applied := v_ip.grade;
  END IF;

  -- MMR/RD 이관: 유리할 때만(MMR 상향·RD 하향)
  v_new_mmr    := GREATEST(COALESCE(v_cur_mmr, 1000), v_ip.mmr);
  v_new_rd     := LEAST(COALESCE(v_cur_rd, 350), v_ip.mmr_rd);
  v_prov       := (v_new_rd > 110) OR (COALESCE(v_cur_games, 0) < 5);
  v_new_source := CASE WHEN v_ip.mmr > COALESCE(v_cur_mmr, 1000)
                       THEN 'import' ELSE COALESCE(v_cur_source, 'self_report') END;

  EXECUTE format(
    'UPDATE profiles SET %I = $1, %I = $2, %I = $3, %I = $4 WHERE id = $5',
    v_mmr_col, v_rd_col, v_prov_col, v_src_col)
    USING v_new_mmr, v_new_rd, v_prov, v_new_source, v_uid;

  -- 명단 claim 확정
  UPDATE imported_players
     SET claimed_by = v_uid, claimed_at = NOW()
   WHERE id = p_imported_id;

  RETURN jsonb_build_object(
    'ok', true, 'already', false, 'imported_id', p_imported_id,
    'mode', v_ip.mode, 'unit', v_ip.unit,
    'grade_applied', v_grade_applied,
    'mmr_before', v_cur_mmr, 'mmr_after', v_new_mmr,
    'rd_before', v_cur_rd,  'rd_after', v_new_rd,
    'source_label', v_ip.source_label
  );
END;
$$;
REVOKE ALL ON FUNCTION claim_imported_player(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_imported_player(uuid) TO authenticated;


-- ============================================================
-- 7. v_imported_ranking — 랭킹 UNION 편의 뷰
--    imported_players(미claim)를 profiles 랭킹 행 모양으로 정규화한다.
--    · 해당 (unit,mode) 트랙 컬럼에만 급수를 채우고 나머지 트랙은 NULL(미보유).
--    · 경기수 0 → Ranking.jsx의 isRanked 미충족 → 항상 "잠정(측정 중)" 섹션에 노출(정직).
--    · name(원문)과 name_masked(홍*동) 둘 다 제공 — 표시는 name_masked 사용 권장.
--    security_invoker=true: 뷰가 호출자 권한으로 imported_players RLS(공개 SELECT)를 탄다.
-- ============================================================
CREATE OR REPLACE VIEW v_imported_ranking
WITH (security_invoker = true) AS
SELECT
  ip.id,
  ip.name,
  bmg_mask_name(ip.name)                                              AS name_masked,
  CASE WHEN ip.mode = 'doubles' THEN ip.mmr    END                   AS mmr,
  CASE WHEN ip.mode = 'doubles' THEN ip.mmr_rd END                   AS mmr_rd,
  0                                                                   AS mmr_games_played,
  CASE WHEN ip.mode = 'singles' THEN ip.mmr    END                   AS singles_mmr,
  CASE WHEN ip.mode = 'singles' THEN ip.mmr_rd END                   AS singles_mmr_rd,
  0                                                                   AS singles_games_played,
  CASE WHEN ip.unit='gu'  AND ip.mode='doubles' THEN ip.grade END    AS grade_gu_dbl,
  CASE WHEN ip.unit='si'  AND ip.mode='doubles' THEN ip.grade END    AS grade_si_dbl,
  CASE WHEN ip.unit='nat' AND ip.mode='doubles' THEN ip.grade END    AS grade_nat_dbl,
  CASE WHEN ip.unit='gu'  AND ip.mode='singles' THEN ip.grade END    AS grade_gu_sgl,
  CASE WHEN ip.unit='si'  AND ip.mode='singles' THEN ip.grade END    AS grade_si_sgl,
  CASE WHEN ip.unit='nat' AND ip.mode='singles' THEN ip.grade END    AS grade_nat_sgl,
  true                                                               AS is_imported,
  ip.unit,
  ip.mode,
  ip.source_label
FROM imported_players ip
WHERE ip.claimed_by IS NULL;

GRANT SELECT ON v_imported_ranking TO anon, authenticated;

COMMENT ON VIEW v_imported_ranking IS '미claim 미가입 선수를 profiles 랭킹행 모양으로 정규화(UNION용). 경기 0 → 항상 잠정 섹션. 표시는 name_masked 사용';


-- ============================================================
-- 끝. 앱 통합 계약 (요약 — 상세는 아키텍트 반환 명세 참조)
--   · ImportResults.jsx: 기존 rpc('bmg_import_participants', {p_import_id, p_unit, p_rows})
--     그대로 동작. 반환 {created, matched, skipped}로 대장 상태/카운트 갱신.
--   · Ranking.jsx: profiles 조회 결과에 v_imported_ranking(선택 unit·mode)을 UNION,
--     is_imported 행은 name_masked로 표시하고 "이 사람이 나예요?(이어받기)" CTA 노출.
--   · claim: 후보 검색은 imported_players 직접 SELECT(공개) — .ilike('name', ...) &
--     claimed_by IS NULL. 본인확인 후 rpc('claim_imported_player', {p_imported_id}).
-- ============================================================
