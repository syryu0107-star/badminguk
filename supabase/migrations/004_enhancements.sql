-- ============================================================
-- 004: 대회 공인 등급 + 카테고리 MMR 범위 게이팅
-- ============================================================

-- tournaments: 공인 등급
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS cert_level TEXT NOT NULL DEFAULT 'none';
-- 'none' | 'c' | 'b' | 'a'

-- tournament_categories: MMR 범위 (선택 옵션)
ALTER TABLE tournament_categories ADD COLUMN IF NOT EXISTS min_mmr INTEGER;
ALTER TABLE tournament_categories ADD COLUMN IF NOT EXISTS max_mmr INTEGER;
ALTER TABLE tournament_categories ADD COLUMN IF NOT EXISTS grade_min TEXT;

-- mmr_history: 파트너 보정 기록 (분석용)
ALTER TABLE mmr_history ADD COLUMN IF NOT EXISTS cert_level TEXT;
ALTER TABLE mmr_history ADD COLUMN IF NOT EXISTS partner_adj INTEGER; -- 보정률 % (±)
