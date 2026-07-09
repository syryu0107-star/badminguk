-- ============================================================
-- 008_stage1_mvp.sql
-- 배드민국 1단계(완주 MVP): 녹아웃 진출 연결 + 심판 점수판 이벤트
-- 규칙: 기존 마이그레이션(001~007) 수정 금지, IF NOT EXISTS 스타일
-- 참고: stage(pool|knockout) 역할은 007의 match_phase 컬럼이 이미 담당
--       (중복 컬럼을 만들지 않는다. 코드는 match_phase 를 사용할 것)
-- ============================================================

-- ----------------------------------------------------------
-- 1. tournament_matches: 브래킷 연결 + 결과 유형 + 라이브 스코어 스냅샷
-- ----------------------------------------------------------

ALTER TABLE tournament_matches
  -- 녹아웃 라운드 번호 (1=1라운드 … 마지막=결승). round_type(텍스트)과 병행.
  ADD COLUMN IF NOT EXISTS round_number    INTEGER,
  -- 같은 라운드 안에서의 슬롯 위치 (1부터). 브래킷 렌더링/진출 연결용.
  ADD COLUMN IF NOT EXISTS bracket_pos     INTEGER,
  -- 이 경기의 승자가 진출하는 다음 경기
  ADD COLUMN IF NOT EXISTS next_match_id   UUID REFERENCES tournament_matches(id) ON DELETE SET NULL,
  -- 다음 경기에서 채울 슬롯: 1=team1_entry_id, 2=team2_entry_id
  ADD COLUMN IF NOT EXISTS next_match_slot INTEGER,
  -- 결과 유형: normal=정상 / walkover=부전승(불참) / retired=경기중 기권 / disqualified=실격
  ADD COLUMN IF NOT EXISTS result_type     TEXT NOT NULL DEFAULT 'normal',
  -- 라이브 스코어 스냅샷 (관전 뷰가 이벤트 접기 없이 바로 읽는 캐시)
  ADD COLUMN IF NOT EXISTS live_game_no    INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS live_score_t1   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS live_score_t2   INTEGER NOT NULL DEFAULT 0,
  -- 현재 서브권 팀 (1|2, NULL=경기 전)
  ADD COLUMN IF NOT EXISTS live_server_team INTEGER;

-- forfeit_reason / forfeit_team 은 001에서 이미 존재 → 추가하지 않음

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'tournament_matches'
      AND constraint_name = 'chk_result_type'
  ) THEN
    ALTER TABLE tournament_matches
      ADD CONSTRAINT chk_result_type
        CHECK (result_type IN ('normal', 'walkover', 'retired', 'disqualified'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'tournament_matches'
      AND constraint_name = 'chk_next_match_slot'
  ) THEN
    ALTER TABLE tournament_matches
      ADD CONSTRAINT chk_next_match_slot
        CHECK (next_match_slot IN (1, 2));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'tournament_matches'
      AND constraint_name = 'chk_live_server_team'
  ) THEN
    ALTER TABLE tournament_matches
      ADD CONSTRAINT chk_live_server_team
        CHECK (live_server_team IN (1, 2));
  END IF;
END
$$;

COMMENT ON COLUMN tournament_matches.round_number    IS '녹아웃 라운드 번호 (1=1라운드, 마지막=결승). 풀 경기는 NULL 가능';
COMMENT ON COLUMN tournament_matches.bracket_pos     IS '라운드 내 슬롯 위치 (1부터)';
COMMENT ON COLUMN tournament_matches.next_match_id   IS '승자가 진출하는 다음 경기 id';
COMMENT ON COLUMN tournament_matches.next_match_slot IS '다음 경기에서 채울 슬롯: 1=team1, 2=team2';
COMMENT ON COLUMN tournament_matches.result_type     IS 'normal|walkover|retired|disqualified';
COMMENT ON COLUMN tournament_matches.live_game_no    IS '진행 중인 게임 번호 (1부터)';
COMMENT ON COLUMN tournament_matches.live_score_t1   IS '진행 중 게임의 팀1 점수 스냅샷';
COMMENT ON COLUMN tournament_matches.live_score_t2   IS '진행 중 게임의 팀2 점수 스냅샷';
COMMENT ON COLUMN tournament_matches.live_server_team IS '현재 서브권 팀 (1|2)';

CREATE INDEX IF NOT EXISTS idx_matches_next
  ON tournament_matches (next_match_id)
  WHERE next_match_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_matches_round
  ON tournament_matches (category_id, round_number, bracket_pos);

-- ----------------------------------------------------------
-- 2. tournament_entries: 최종 순위 저장
-- ----------------------------------------------------------

ALTER TABLE tournament_entries
  -- 종목(카테고리) 내 최종 순위: 1=우승, 2=준우승, 3=3위 …
  ADD COLUMN IF NOT EXISTS final_rank INTEGER,
  -- 조별리그 내 순위 (풀 완료 시 기록, 와일드카드 산정 근거)
  ADD COLUMN IF NOT EXISTS pool_rank  INTEGER;

COMMENT ON COLUMN tournament_entries.final_rank IS '종목 내 최종 순위 (1=우승). 대회 완주 시 기록';
COMMENT ON COLUMN tournament_entries.pool_rank  IS '조별리그 순위 (풀 스테이지 완료 시 기록)';

-- ----------------------------------------------------------
-- 3. match_events: 점수 이벤트 로그 (append-only)
--    언두는 행 삭제가 아니라 event_type='undo' 이벤트 추가로 처리
-- ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS match_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id     UUID        NOT NULL REFERENCES tournament_matches(id) ON DELETE CASCADE,
  event_type   TEXT        NOT NULL,
  -- point: 득점한 팀 / card: 대상 팀 / walkover: 기권한 팀. 그 외 NULL 가능
  team_no      INTEGER,
  game_no      INTEGER     NOT NULL DEFAULT 1,
  -- 이벤트 적용 "후"의 현재 게임 점수 스냅샷
  score_t1     INTEGER     NOT NULL DEFAULT 0,
  score_t2     INTEGER     NOT NULL DEFAULT 0,
  -- 이벤트 적용 후의 서브권 팀 (1|2)
  server_team  INTEGER,
  -- 부가 정보: card 종류(yellow|red|black), 사유 등
  meta         JSONB,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_event_type CHECK (
    event_type IN ('match_start','point','undo','interval','game_end','match_end','card','walkover','retired')
  ),
  CONSTRAINT chk_event_team   CHECK (team_no IN (1, 2)),
  CONSTRAINT chk_event_server CHECK (server_team IN (1, 2)),
  CONSTRAINT chk_event_scores CHECK (score_t1 >= 0 AND score_t2 >= 0)
);

COMMENT ON TABLE  match_events IS '경기 점수 이벤트 로그 (append-only). 언두=undo 이벤트 추가';
COMMENT ON COLUMN match_events.score_t1 IS '이벤트 적용 후 현재 게임 팀1 점수';
COMMENT ON COLUMN match_events.score_t2 IS '이벤트 적용 후 현재 게임 팀2 점수';

CREATE INDEX IF NOT EXISTS idx_match_events_match
  ON match_events (match_id, created_at);

ALTER TABLE match_events ENABLE ROW LEVEL SECURITY;

-- 읽기: 공개 (관전 뷰)
DROP POLICY IF EXISTS "events_read_all" ON match_events;
CREATE POLICY "events_read_all"
  ON match_events FOR SELECT
  USING (true);

-- 쓰기: 인증 사용자만 INSERT (UPDATE/DELETE 정책 없음 = append-only)
DROP POLICY IF EXISTS "events_insert_auth" ON match_events;
CREATE POLICY "events_insert_auth"
  ON match_events FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ----------------------------------------------------------
-- 4. 실시간 구독 등록 (이미 등록된 테이블은 예외 무시)
-- ----------------------------------------------------------

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE tournament_matches;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE match_scores;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE match_events;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END
$$;
