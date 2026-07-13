-- 015: 무심판 코트 셀프 스코어 — match_events 에 'self_score' 이벤트 타입 허용
-- ──────────────────────────────────────────────────────────────────────
-- 왜 필요한가:
--   동호인 대회는 코트마다 심판을 둘 인원이 없어 선수들이 스스로 점수를 부르고
--   결과만 알린다. 배드민국은 지금껏 심판/주최자만 tournament_matches 를 갱신할 수
--   있어(001 RLS "주최자 관리"), 무심판 코트에서는 경기가 completed 로 넘어가지
--   못해 승자 진출·급수 반영 자동화가 멈췄다.
--
--   해결: 경기에 뛴 선수가 자기 최종 점수를 match_events 에 append 로 제출한다.
--   match_events 의 INSERT 정책은 이미 008 에서 "인증 사용자 삽입"(events_insert_auth)
--   이라 선수가 넣을 수 있으나, 008 의 chk_event_type CHECK 제약이 고정된 타입만
--   허용해 'self_score' insert 가 거부된다. 이 마이그레이션이 그 허용 목록에
--   'self_score' 를 추가한다. (실제 경기 확정은 여전히 주최자 브라우저의
--   completeMatch 가 하거나, 양 팀 합의 시 무인 오케스트레이터가 자동 실행한다 —
--   선수가 직접 tournament_matches 를 쓰지 않으므로 새 RLS 는 필요 없다.)
--
-- 안전:
--   · CHECK 제약만 완화(기존 타입 전부 유지 + self_score 추가) — 기존 데이터·경로 무영향.
--   · IF EXISTS / 재생성이라 반복 실행 안전.
--   · 이 마이그레이션이 적용되기 전에는 self_score insert 가 실패하고, 앱은 이를
--     graceful 하게 처리(선수에게 "아직 셀프 점수 기능이 활성화되지 않았어요" 안내)한다.

ALTER TABLE match_events DROP CONSTRAINT IF EXISTS chk_event_type;

ALTER TABLE match_events
  ADD CONSTRAINT chk_event_type CHECK (
    event_type IN (
      'match_start', 'point', 'undo', 'interval', 'game_end',
      'match_end', 'card', 'walkover', 'retired', 'self_score'
    )
  );

COMMENT ON CONSTRAINT chk_event_type ON match_events IS
  '허용 이벤트 타입. self_score=무심판 코트에서 선수가 제출한 최종 점수(meta.games/winner_team).';
