-- ============================================================
-- 018_bank_account.sql
-- 무통장 입금 계좌 정보 — 주최자 대회 설정 → 선수 입금 안내 자동 표시
--
-- 목적(입금 단계 완주 갭 메우기):
--   지금껏 선수 입금 안내(deposit.js)는 "얼마를 · 어떤 입금자명으로" 까지만
--   화면에 알려 주고, 정작 "어느 계좌로 보내야 하는지"(은행·계좌번호·예금주)는
--   앱에 없어 선수가 단톡방/문의로 따로 물어봐야 했다(북극성 접수→입금 체인 중
--   유일하게 앱 밖으로 새던 조각). 이 컬럼들이 그 계좌 정보를 대회에 담아,
--   선수 "입금 안내" 카드가 계좌번호(복사 버튼)까지 앱 하나로 완결하게 한다.
--
-- ⚠️ 경계:
--   · PG(카드)·가상계좌·실결제는 여전히 human-gated. 이건 "무통장 입금 계좌를
--     텍스트로 보여 주는 것"뿐 — 외부 키·서버 발송 불필요.
--   · 001~017 수정 금지. 멱등(IF NOT EXISTS).
--   · 앱 코드는 이 컬럼이 없어도 degrade(계좌 미표시)하도록 짜여 있다 —
--     이 마이그레이션 적용 전/후 모두 안전.
-- ============================================================

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS bank_name    text;  -- 은행명 (예: 국민)
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS bank_account text;  -- 계좌번호
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS bank_holder  text;  -- 예금주 (실명)

COMMENT ON COLUMN tournaments.bank_name    IS '무통장 입금 은행명 (선택)';
COMMENT ON COLUMN tournaments.bank_account IS '무통장 입금 계좌번호 (선택)';
COMMENT ON COLUMN tournaments.bank_holder  IS '무통장 입금 예금주 실명 (선택)';
