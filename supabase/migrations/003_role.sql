-- ============================================================
-- 003: 사용자 역할 (선수 / 주최자)
-- ============================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'player';
-- 'player' | 'organizer'
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
