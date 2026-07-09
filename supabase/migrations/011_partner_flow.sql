-- ============================================================
-- 011: 복식 파트너 초대 → 수락 플로우 (감사 S1 / M1 / M6)
--   - entry_status에 'partner_pending','partner_rejected' 추가
--   - 같은 두 사람의 양방향 중복 팀 등록 방지
--   - 파트너(player2)가 초대를 수락/거절할 수 있게 RLS 확장
--   - 초대 응답 시각 메타 컬럼
-- 멱등(idempotent). 001~010은 수정하지 않는다.
-- ⚠️ entry_status는 001에서 enum이 아니라 CHECK 제약(chk_entry_status)이므로
--    제약을 재정의(DROP + ADD)한다. (ALTER TYPE 불필요)
-- ============================================================

-- ── 1. entry_status 값 확장 (CHECK 제약 재정의) ────────────────
--   기존: applied / approved / rejected / withdrawn / waitlisted
--   추가: partner_pending (파트너 수락 대기), partner_rejected (파트너 거절)
ALTER TABLE tournament_entries DROP CONSTRAINT IF EXISTS chk_entry_status;
ALTER TABLE tournament_entries ADD CONSTRAINT chk_entry_status CHECK (
  entry_status IN (
    'applied',          -- 접수 완료(파트너 수락됨 · 주최자 승인 대기)
    'approved',         -- 주최자 승인
    'rejected',         -- 주최자 반려
    'withdrawn',        -- 신청자 철회
    'waitlisted',       -- 대기순번
    'partner_pending',  -- (신규) 파트너 수락 대기
    'partner_rejected'  -- (신규) 파트너 거절
  )
);

-- ── 2. 초대 응답 메타 컬럼 ─────────────────────────────────────
ALTER TABLE tournament_entries
  ADD COLUMN IF NOT EXISTS partner_responded_at TIMESTAMPTZ;

-- ── 3. 중복 신청 방지 인덱스 재정의 ───────────────────────────
--   (a) 기존 (category_id, player1_id) 유니크: 신청자 본인 기준 중복 차단.
--       기존엔 withdrawn만 제외 → partner_rejected도 제외해야
--       거절당한 뒤 같은 사람이 다시 신청할 수 있다.
DROP INDEX IF EXISTS idx_entries_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_unique
  ON tournament_entries(category_id, player1_id)
  WHERE entry_status NOT IN ('withdrawn', 'partner_rejected');

--   (b) (신규) 양방향 팀 중복 차단: 같은 두 사람이 같은 종목에
--       서로 다른 두 팀(A→B, B→A)으로 각각 등록되는 것을 막는다.
--       정렬된 페어(LEAST/GREATEST)로 (A,B)와 (B,A)를 동일 키로 취급.
--       단식/파트너 미지정(player2_id IS NULL)은 대상 아님.
DROP INDEX IF EXISTS idx_entries_pair_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_pair_unique
  ON tournament_entries(
       category_id,
       LEAST(player1_id, player2_id),
       GREATEST(player1_id, player2_id)
     )
  WHERE player2_id IS NOT NULL
    AND entry_status NOT IN ('withdrawn', 'partner_rejected');

-- ── 4. 파트너(player2) 수락/거절 RLS ──────────────────────────
--   001의 insert 정책("신청자 삽입" WITH CHECK auth.uid()=player1_id)과
--   update 정책("본인/주최자 수정" USING player1_id or organizer)은 유지.
--   여기서 player2도 자기가 묶인 신청을 UPDATE(수락→applied / 거절→partner_rejected)
--   할 수 있게 별도 permissive 정책을 추가한다.
--   USING만 지정 → Postgres가 UPDATE의 WITH CHECK로도 동일 식을 적용하므로
--   player2는 player2_id=자신인 행에서만, 자신을 벗어나게 바꿀 수 없다.
DROP POLICY IF EXISTS "파트너 수락거절" ON tournament_entries;
CREATE POLICY "파트너 수락거절" ON tournament_entries FOR UPDATE
  USING (auth.uid() = player2_id);
