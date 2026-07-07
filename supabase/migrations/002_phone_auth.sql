-- ============================================================
-- 002: 전화번호 인증 + 반치팅(하위급수 출전 방지) 시스템
-- ============================================================

-- ── 1. OTP 임시 저장 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS phone_otps (
  phone       TEXT PRIMARY KEY,
  otp         TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5분 만료 행 자동 삭제 (pg_cron 없이 SELECT 시 필터)
CREATE INDEX IF NOT EXISTS idx_phone_otps_expires ON phone_otps(expires_at);

-- ── 2. 전화번호 영구 기록 (반치팅 핵심) ─────────────────────────
--   계정을 삭제해도 이 테이블은 삭제하지 않는다.
--   동일 번호로 재가입 시 peak_grade / mmr 복원 → 낮은 조 출전 불가.
CREATE TABLE IF NOT EXISTS phone_records (
  phone           TEXT PRIMARY KEY,
  peak_grade      TEXT NOT NULL DEFAULT '왕초심',
  peak_grade_idx  INTEGER NOT NULL DEFAULT 0,  -- 숫자 비교용 (0=왕초심…7=자강조)
  current_mmr     INTEGER NOT NULL DEFAULT 1000,
  peak_mmr        INTEGER NOT NULL DEFAULT 1000,
  total_games     INTEGER NOT NULL DEFAULT 0,
  last_user_id    UUID,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_records_grade ON phone_records(peak_grade_idx DESC);

-- ── 3. profiles 에 phone 컬럼 추가 ───────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles(phone);

-- ── 4. 급수 → 인덱스 매핑 함수 ─────────────────────────────────
CREATE OR REPLACE FUNCTION grade_to_idx(g TEXT) RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE g
    WHEN '왕초심' THEN 0
    WHEN '초심'   THEN 1
    WHEN 'D조'    THEN 2
    WHEN 'C조'    THEN 3
    WHEN 'B조'    THEN 4
    WHEN 'A조'    THEN 5
    WHEN '준자강'  THEN 6
    WHEN '자강조'  THEN 7
    ELSE 0
  END;
$$;

-- ── 5. 프로필 업데이트 시 phone_records 자동 갱신 트리거 ────────
--   peak는 오직 올라가기만 함 → 낮은 급수/MMR로 내릴 수 없음
CREATE OR REPLACE FUNCTION sync_phone_records() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  new_grade_idx INTEGER := grade_to_idx(NEW.official_grade);
BEGIN
  IF NEW.phone IS NULL THEN RETURN NEW; END IF;

  INSERT INTO phone_records (phone, peak_grade, peak_grade_idx, current_mmr, peak_mmr, total_games, last_user_id)
  VALUES (
    NEW.phone,
    NEW.official_grade,
    new_grade_idx,
    NEW.mmr,
    NEW.mmr,
    NEW.mmr_games_played,
    NEW.id
  )
  ON CONFLICT (phone) DO UPDATE SET
    -- 급수는 오직 높은 쪽으로만 갱신
    peak_grade      = CASE WHEN new_grade_idx > phone_records.peak_grade_idx
                           THEN NEW.official_grade
                           ELSE phone_records.peak_grade END,
    peak_grade_idx  = GREATEST(phone_records.peak_grade_idx, new_grade_idx),
    -- MMR은 현재값 갱신, peak는 최고치 유지
    current_mmr     = NEW.mmr,
    peak_mmr        = GREATEST(phone_records.peak_mmr, NEW.mmr),
    total_games     = GREATEST(phone_records.total_games, NEW.mmr_games_played),
    last_user_id    = NEW.id,
    updated_at      = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_phone_records ON profiles;
CREATE TRIGGER trg_sync_phone_records
  AFTER INSERT OR UPDATE OF official_grade, mmr, mmr_games_played ON profiles
  FOR EACH ROW EXECUTE FUNCTION sync_phone_records();

-- ── 6. RLS ───────────────────────────────────────────────────
ALTER TABLE phone_otps    ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_records ENABLE ROW LEVEL SECURITY;

-- OTP는 서비스롤만 접근 (Edge Function)
CREATE POLICY "service only" ON phone_otps    FOR ALL USING (false);
CREATE POLICY "service only" ON phone_records FOR ALL USING (false);
-- 서비스롤 키로는 RLS 우회 → OK
