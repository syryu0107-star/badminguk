-- ============================================================
-- 007_tournament_config.sql
-- 배드민국 토너먼트 포맷/풀 구성 마이그레이션
-- ============================================================

-- ----------------------------------------------------------
-- 1. tournament_categories 컬럼 추가
-- ----------------------------------------------------------

ALTER TABLE tournament_categories
  ADD COLUMN IF NOT EXISTS tournament_format TEXT NOT NULL DEFAULT 'round_robin',
  ADD COLUMN IF NOT EXISTS pool_size INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS advancement_per_pool INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS wildcard_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wildcard_criteria TEXT NOT NULL DEFAULT 'score_diff',
  ADD COLUMN IF NOT EXISTS games_per_match INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS points_per_game INTEGER NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS prize_spots INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS min_teams INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS seeding_enabled BOOLEAN NOT NULL DEFAULT false;

-- tournament_format 허용값 체크 제약
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'tournament_categories'
      AND constraint_name = 'chk_tournament_format'
  ) THEN
    ALTER TABLE tournament_categories
      ADD CONSTRAINT chk_tournament_format
        CHECK (tournament_format IN ('round_robin', 'single_elim', 'pool_knockout', 'pool_only'));
  END IF;
END
$$;

-- wildcard_criteria 허용값 체크 제약
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'tournament_categories'
      AND constraint_name = 'chk_wildcard_criteria'
  ) THEN
    ALTER TABLE tournament_categories
      ADD CONSTRAINT chk_wildcard_criteria
        CHECK (wildcard_criteria IN ('score_diff', 'win_rate', 'head_to_head'));
  END IF;
END
$$;

-- games_per_match 허용값 체크 제약
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'tournament_categories'
      AND constraint_name = 'chk_games_per_match'
  ) THEN
    ALTER TABLE tournament_categories
      ADD CONSTRAINT chk_games_per_match
        CHECK (games_per_match IN (1, 3, 5));
  END IF;
END
$$;

-- points_per_game 허용값 체크 제약
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'tournament_categories'
      AND constraint_name = 'chk_points_per_game'
  ) THEN
    ALTER TABLE tournament_categories
      ADD CONSTRAINT chk_points_per_game
        CHECK (points_per_game IN (11, 15, 21));
  END IF;
END
$$;

COMMENT ON COLUMN tournament_categories.tournament_format    IS '대회 방식: round_robin=리그전, single_elim=토너먼트(단판), pool_knockout=풀+녹아웃, pool_only=풀 리그만';
COMMENT ON COLUMN tournament_categories.pool_size            IS '풀당 팀 수 (pool_knockout / pool_only 방식에서 사용)';
COMMENT ON COLUMN tournament_categories.advancement_per_pool IS '풀에서 녹아웃으로 진출하는 팀 수';
COMMENT ON COLUMN tournament_categories.wildcard_count       IS '풀 스테이지 와일드카드 진출 수';
COMMENT ON COLUMN tournament_categories.wildcard_criteria    IS '와일드카드 선정 기준: score_diff=점수차, win_rate=승률, head_to_head=상대전적';
COMMENT ON COLUMN tournament_categories.games_per_match      IS '매치당 게임 수: 1=단판, 3=3판2선승, 5=5판3선승';
COMMENT ON COLUMN tournament_categories.points_per_game      IS '게임당 포인트: 21 / 15 / 11';
COMMENT ON COLUMN tournament_categories.prize_spots          IS '시상 순위: 1=우승만, 3=3위까지, 4=4강까지';
COMMENT ON COLUMN tournament_categories.min_teams            IS '최소 참가 팀 수 (미달 시 경고)';
COMMENT ON COLUMN tournament_categories.seeding_enabled      IS 'MMR 기반 시드 배정 활성화 여부';


-- ----------------------------------------------------------
-- 2. tournament_pools 테이블 생성
-- ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS tournament_pools (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  UUID        NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  pool_name    TEXT        NOT NULL,
  pool_index   INTEGER     NOT NULL,
  draw_seed    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (category_id, pool_index)
);

COMMENT ON TABLE  tournament_pools            IS '대회 카테고리 내 풀(조) 목록';
COMMENT ON COLUMN tournament_pools.pool_name  IS '풀 표시명 (A조, B조 …)';
COMMENT ON COLUMN tournament_pools.draw_seed  IS '풀 추첨 재현을 위한 시드 문자열';

ALTER TABLE tournament_pools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pools_allow_all" ON tournament_pools;
CREATE POLICY "pools_allow_all"
  ON tournament_pools
  FOR ALL
  USING (true);


-- ----------------------------------------------------------
-- 3. tournament_pool_entries 테이블 생성
-- ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS tournament_pool_entries (
  pool_id      UUID    NOT NULL REFERENCES tournament_pools(id)   ON DELETE CASCADE,
  entry_id     UUID    NOT NULL REFERENCES tournament_entries(id) ON DELETE CASCADE,
  seeding_rank INTEGER,

  PRIMARY KEY (pool_id, entry_id)
);

COMMENT ON TABLE  tournament_pool_entries              IS '풀(조)별 참가팀 매핑';
COMMENT ON COLUMN tournament_pool_entries.seeding_rank IS 'MMR 시드 배정 시 해당 팀의 시드 번호';

ALTER TABLE tournament_pool_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pool_entries_allow_all" ON tournament_pool_entries;
CREATE POLICY "pool_entries_allow_all"
  ON tournament_pool_entries
  FOR ALL
  USING (true);


-- ----------------------------------------------------------
-- 4. tournament_matches 컬럼 추가
-- ----------------------------------------------------------

ALTER TABLE tournament_matches
  ADD COLUMN IF NOT EXISTS pool_id         UUID REFERENCES tournament_pools(id),
  ADD COLUMN IF NOT EXISTS match_phase     TEXT DEFAULT 'pool',
  ADD COLUMN IF NOT EXISTS games_won_team1 INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS games_won_team2 INTEGER DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'tournament_matches'
      AND constraint_name = 'chk_match_phase'
  ) THEN
    ALTER TABLE tournament_matches
      ADD CONSTRAINT chk_match_phase
        CHECK (match_phase IN ('pool', 'knockout'));
  END IF;
END
$$;

COMMENT ON COLUMN tournament_matches.pool_id         IS '풀 리그 경기인 경우 해당 풀 ID';
COMMENT ON COLUMN tournament_matches.match_phase     IS '경기 단계: pool=풀 리그, knockout=토너먼트';
COMMENT ON COLUMN tournament_matches.games_won_team1 IS '팀1 게임 승수 (3판2선승 등 멀티게임 방식에서 사용)';
COMMENT ON COLUMN tournament_matches.games_won_team2 IS '팀2 게임 승수';


-- ----------------------------------------------------------
-- 인덱스
-- ----------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_tournament_pools_category
  ON tournament_pools (category_id);

CREATE INDEX IF NOT EXISTS idx_pool_entries_pool
  ON tournament_pool_entries (pool_id);

CREATE INDEX IF NOT EXISTS idx_pool_entries_entry
  ON tournament_pool_entries (entry_id);

CREATE INDEX IF NOT EXISTS idx_matches_pool
  ON tournament_matches (pool_id)
  WHERE pool_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_matches_phase
  ON tournament_matches (match_phase);
