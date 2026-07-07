-- ============================================================
-- 005: PASS 실명인증 + 단식/복식 MMR 분리
-- ============================================================

-- ── 실명인증 필드 (phone_records — 영구, 재가입 시에도 유지) ────
ALTER TABLE phone_records ADD COLUMN IF NOT EXISTS verified_name  TEXT;
ALTER TABLE phone_records ADD COLUMN IF NOT EXISTS verified_birth TEXT; -- YYYYMMDD
ALTER TABLE phone_records ADD COLUMN IF NOT EXISTS verified_gender TEXT; -- M | F
ALTER TABLE phone_records ADD COLUMN IF NOT EXISTS identity_verified BOOLEAN NOT NULL DEFAULT false;

-- ── 프로필 실명인증 필드 ──────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verified_name    TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verified_birth   TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verified_gender  TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS identity_verified BOOLEAN NOT NULL DEFAULT false;

-- ── 단식 MMR (복식은 기존 mmr/official_grade 유지) ──────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS singles_grade        TEXT NOT NULL DEFAULT '왕초심';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS singles_mmr          INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS singles_games_played INTEGER NOT NULL DEFAULT 0;

-- phone_records에도 단식 peak 추적
ALTER TABLE phone_records ADD COLUMN IF NOT EXISTS singles_peak_grade     TEXT NOT NULL DEFAULT '왕초심';
ALTER TABLE phone_records ADD COLUMN IF NOT EXISTS singles_peak_grade_idx INTEGER NOT NULL DEFAULT 0;
ALTER TABLE phone_records ADD COLUMN IF NOT EXISTS singles_peak_mmr       INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE phone_records ADD COLUMN IF NOT EXISTS singles_current_mmr    INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE phone_records ADD COLUMN IF NOT EXISTS singles_total_games    INTEGER NOT NULL DEFAULT 0;

-- ── mmr_history: 단식/복식 구분 ──────────────────────────────
ALTER TABLE mmr_history ADD COLUMN IF NOT EXISTS game_mode TEXT NOT NULL DEFAULT 'doubles'; -- 'singles' | 'doubles'

-- ── tournament_categories: 단식 종목 추가 허용 (sport_type에 남단/여단) ─
-- sport_type은 TEXT라 별도 마이그레이션 불필요 (남단/여단 값 그대로 입력)

-- ── 체크인 기록 테이블 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournament_checkins (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  checked_in_by   UUID, -- 확인한 심판/주최자 id
  verified_method TEXT NOT NULL DEFAULT 'verbal', -- 'verbal' | 'id_card' | 'auto'
  checked_in_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  flagged         BOOLEAN NOT NULL DEFAULT false,  -- 의심 신고
  flag_reason     TEXT,
  UNIQUE(tournament_id, player_id)
);

ALTER TABLE tournament_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "organizer_checkin" ON tournament_checkins FOR ALL USING (true); -- 주최자/심판이 쓰므로 TEST_MODE에선 전체 허용
