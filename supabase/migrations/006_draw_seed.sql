-- 006: 공개 추첨 씨드 저장 (누구나 결과 검증 가능)
ALTER TABLE tournament_matches ADD COLUMN IF NOT EXISTS draw_seed TEXT;
