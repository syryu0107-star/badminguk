-- 009: 조별 동률 처리 기준 커스터마이징 (대회 종목별)
-- 값: 'h2h'(승자승, 2팀 동률만) | 'game_diff'(게임 득실) | 'point_diff'(점수 득실) | 'points_for'(다득점)
-- 배열 순서 = 적용 순서. 승수(wins)는 항상 1순위 고정.
ALTER TABLE tournament_categories
  ADD COLUMN IF NOT EXISTS tiebreaker_order TEXT[] NOT NULL
    DEFAULT ARRAY['h2h', 'game_diff', 'point_diff', 'points_for'];

COMMENT ON COLUMN tournament_categories.tiebreaker_order IS
  '조별리그 동률 처리 기준 순서. h2h|game_diff|point_diff|points_for';
