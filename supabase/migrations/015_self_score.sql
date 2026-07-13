-- 015: 무심판 코트 셀프 스코어 이벤트 타입 허용 (selfScore.js)
-- selfScore.js가 선수 자가 점수 제출을 match_events에 event_type='self_score'로 append하는데,
-- 008의 chk_event_type CHECK가 기존 9개 타입만 허용해 막혀 있었다. 'self_score'를 추가한다.
-- 멱등: 제약을 DROP 후 재정의. 값 순서·기존 9개는 그대로 유지 + self_score 추가.
ALTER TABLE match_events DROP CONSTRAINT IF EXISTS chk_event_type;
ALTER TABLE match_events ADD CONSTRAINT chk_event_type CHECK (
  event_type IN (
    'match_start','point','undo','interval','game_end','match_end',
    'card','walkover','retired',
    'self_score'
  )
);
