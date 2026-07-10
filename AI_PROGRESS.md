# AI 자동 개선 로그

> 자율 개선 에이전트가 완료한 로드맵 항목 기록. 이미 완료된 항목은 다시 하지 않는다.
> 각 항목: 날짜(UTC) · 로드맵 번호 · 변경 파일 · 한 줄 요약.

## 2026-07-10 — [C3] 무통장 입금 자동 매칭 (입금자명 퍼지매칭 → 자동 입금확인 → 무인 승인 연결)

- **C3 무통장 입금 대조 자동화 (필수/대, 주최자 완주 최대 공백)**
  - 파일: `src/lib/payment.js`(신규), `src/pages/organizer/EntryManagement.jsx`
  - 요약: `payment_status`('pending'/'confirmed'/'refunded') 컬럼은 001부터 있었지만 이를 'confirmed'로 바꾸는 코드 경로가 앱 어디에도 없었다. 그 결과 참가비가 있는 신청은 자동 승인 엔진(planAutoApprovals)의 "입금대기" 사람 큐에 영구히 갇혀, 주최자 무인 완주가 원천 불가능했다(가장 큰 남은 공백). 이번 런은 키가 필요 없는 계좌 무통장 입금 대조를 순수 로직으로 자동화했다(실PG·가상계좌·환불은 human-gated 유지). 순수 엔진 `payment.js` 신설 — `normalizeName`(괄호·(주)·꼬리 동명이인 숫자·공백 제거 후 한글/영문만), `parseAmount`("30,000원"/"₩30000"→30000), `nameSimilarity`(정규화 동일=1·포함관계=0.9·그 외 Levenshtein 편집거리 비율로 오타 허용), `parseDeposits`(은행/토스 내역 붙여넣기를 관대하게 [{name,amount,raw}]로 파싱 — 각 줄 최대 금액 덩어리를 입금액으로, 날짜 4자리·콤마 규칙으로 날짜 오인식 방지, 첫 한글/영문 토큰을 이름으로), `matchDeposits`(참가비>0·미확인·철회/거절 제외 신청 ↔ 입금 그리디 매칭 — 유사도≥0.85 AND 입금액≥참가비면 confirmed 자동확인, 유사도 0.6~0.85·금액부족·후보경합이면 review 확인권장, 입금 1건=신청 1건 중복배정 차단, 미매칭 신청·미사용 입금을 각각 분리 반환). EntryManagement에 "입금 자동 매칭" 접이식 패널 추가 — 참가비 있는 대회에서만 노출, 상단에 현재 입금대기 건수, 은행 내역 붙여넣기 textarea, 자동확인/확인권장/미매칭 3분류 요약 카드, "자동 확인 N건 입금 완료 처리" 일괄 버튼(payment_status='confirmed' 낙관적 반영)과 review 행별 "입금 확인" 1탭 개별 처리(입금자명·금액·사유 표시), 신청과 못 붙은 입금(오입금·미신청·이름 상이) 안내. 입금이 confirmed로 바뀌면 buckets가 재계산돼 payment 버킷이 비고, 무인 자동 승인 스위치가 켜져 있으면 그대로 자동 승인까지 이어진다(별도 트리거 불필요, 기존 useEffect가 처리). 스키마 변경 없음. 엔진 20개 시나리오(정규화·파싱·유사도·매칭 4버킷·경합·미매칭) 자체 검증 통과, `npx vite build` green.

## 2026-07-09 — [C4] 셀프 체크인 — 디지털 선수증 + 무인 실시간 집계

- **C4 셀프 체크인 (필수/중, 선수 완주 최대 공백)**
  - 파일: `src/lib/checkin.js`(신규), `src/pages/player/MyMatches.jsx`, `src/pages/organizer/LiveDashboard.jsx`
  - 요약: 지금껏 체크인은 운영자가 선수 실명·생년을 물어보고 손으로 "체크인 완료"를 눌러야만 했던 전면 수작업이라, 선수 완주(신청→체크인→호출→결과)의 중간이 사람 손에 묶여 있었다. 이번 런은 스키마 변경 없이(기존 `tournament_checkins.verified_method`에 'self' 값만 추가) 선수가 자기 폰으로 스스로 체크인하게 만들었다. 순수 함수 엔진 `checkin.js` 신설 — `getCheckinWindow(tournament, now)`는 대회 date/status로 셀프 체크인 창을 판정한다(status가 in_progress면 지각 포함 언제나 open, 그 외엔 로컬 날짜가 대회 당일이면 open·이전이면 before·이후면 ended, completed/cancelled는 ended). `assessSelfCheckin(profile)`은 실명인증(identity_verified) 선수는 본인확인까지 무인 완료로, 미인증 선수는 "현장 본인확인 권장"으로 분류해 대리출전 예외만 사람에게 남긴다. `summarizeCheckins(players, checkins)`는 done/self/flagged/reviewNeeded 집계, `selfCheckin`(upsert method='self')·`fetchMyCheckins`(대회 다건 배치 조회, 테이블 미존재 시 try/catch degrade) Supabase 헬퍼 포함. 선수 MyMatches 상단에 "체크인 · 디지털 선수증" 섹션 추가 — 참가 확정(approved) 대회를 대회 단위로 묶어(중복 종목 1장) 카드로 보여주고(실명/닉네임·실명인증 배지·종목·장소·날짜), 창이 열려 있으면 원터치 "지금 셀프 체크인" 버튼(누르면 낙관적으로 즉시 완료 반영)·미인증 안내, 완료 시 초록 확정 카드+체크인 시각, 아직 전이면 "대회 당일 오전부터" 안내. 종료/마감 대회는 카드에서 자동 숨김. 주최자 LiveDashboard 체크인 패널은 `tournament_checkins`를 대회 id로 실시간 구독해 선수가 폰으로 체크인하는 즉시 무인으로 목록·요약이 갱신되고, 상단에 "완료 N/전체 · 셀프 K · 본인확인 권장 · 신고" 요약 카드, 각 선수 행에는 "셀프 완료" 배지와 셀프+미인증인 경우 "본인확인 권장" 배지를 달아 예외만 눈에 띄게 했다. 안내 문구도 "폰으로 셀프 체크인하면 자동 표시, 본인확인 권장만 현장 확인"으로 갱신. 엔진 7개 시나리오 자체 검증 통과, `npx vite build` green.

## 2026-07-09 — [C2] 대회 상태 오케스트레이션 — 자동 마감·시작 + 무인 참가 승인

- **C2 자동 마감/시작 상태머신 + 정상 신청 자동 승인 (필수/대, 주최자 완주 최대 공백)**
  - 파일: `src/lib/stateMachine.js`(신규), `src/pages/organizer/TournamentManage.jsx`, `src/pages/organizer/EntryManagement.jsx`
  - 요약: 지금껏 주최자가 손으로 눌러야 했던 "접수 마감 / 대회 시작 / 참가 신청 승인"을 앱이 스스로 판정하게 했다(C2 ❌→⚠️, 주최자 자동화 최대 공백). 순수 함수 엔진 `stateMachine.js` 신설 — `planTournamentState`는 실측 데이터로 다음 상태를 판정한다: open→closed(접수 마감 시각 경과 or 전 종목 정원 충족, 무인 안전), closed→in_progress(대회 당일 도래 + 대진표 존재, 무인 안전), in_progress→completed(부전승 제외 실경기 전부 완료 → MMR·급수 반영이 걸려 있어 무인 전환은 안 하고 "한 번 확인" 추천만). 대회 당일인데 대진표가 없으면 blockReason으로 "대진표 먼저 생성" 안내. `planAutoApprovals`는 applied 신청을 auto/review/payment/capacity 4버킷으로 분류 — 샌드배깅 의심(sandbag.js 재사용)·참가비 미입금·정원 초과만 사람 큐로 남기고 나머지 정상 신청은 자동 승인 대상. TournamentManage에 "무인 자동 진행" 스위치(기본 OFF·localStorage 기억)를 달아, 20초 틱으로 now를 갱신해 마감 시각/당일 도래를 감지하고, ON이면 안전 전환을 useEffect에서 1회 자동 적용(autoAppliedRef로 중복 차단), OFF여도 추천 배너 + "지금 전환" 원터치를 제공. EntryManagement에 "무인 자동 승인" 스위치 + 4버킷 분류 요약 카드 + "안전한 N건 지금 자동 승인" 일괄 버튼 추가(ON이면 신규 정상 신청을 들어오는 대로 승인). 스키마 변경 없음 — 기존 registration_end·date·max_teams·entry_fee·payment_status·entry_status만 사용. 엔진 5개 상태 시나리오 + 승인 4버킷 esbuild 번들 자체 검증 통과, `npx vite build` green.

## 2026-07-09 — [C7] 노쇼(호출 미응답) 타이머 → 미입장 부전승 카운트다운

- **C7 호출 미응답 타이머 → 워크오버 카운트다운 (필수/대, 운영 완주 최대 공백)**
  - 파일: `src/lib/orchestrator.js`(planNoShow 추가), `src/lib/notify.js`(buildWalkoverWarn·callWalkoverWarn 추가), `src/pages/organizer/LiveDashboard.jsx`, `src/pages/player/MyMatches.jsx`
  - 요약: 직전 런에서 만든 자동 호출 오케스트레이터는 "부르기"까지만 자동이라, 선수가 코트로 오지 않으면 경기가 무한 정지하고 사람이 손으로 부전승을 눌러야 했다(운영 완주를 막는 최대 공백). 이번 런은 순수 함수 `planNoShow(matches, {calledAt, warnedAt, warnAfterSec=120, forfeitAfterSec=300, now})`를 신설해 호출 시각 대비 경과 시간으로 각 경기를 waiting/warned/overdue 3단계로 분류한다(호출 안 됐거나 이미 시작·완료된 경기는 제외). LiveDashboard는 호출 이력이 있는 동안 10초 틱(setInterval)으로 카운트다운을 갱신하고, 예정 카드에 "미응답 부전승까지 m:ss"를 waiting(주황)/warned(빨강)으로 표기한다. 무인 진행 스위치가 켜져 있으면 warned 진입 순간 `callWalkoverWarn`(기존에 정의만 되고 미사용이던 WALKOVER_WARN 타입 활용)를 선수에게 1회 자동 발송하고(warnedRef로 중복 차단, 재호출 시 초기화해 다시 경고 가능), 자동 조치 로그에 남긴다. forfeitAfterSec를 넘긴 overdue 경기는 상단 "노쇼 확인 대기" 패널에 모아 경과 시간·팀별 원터치 부전승·"다시 호출" 버튼으로 노출 — 부전승은 `completeMatch(walkover)`로 처리돼 MMR 미반영 + 승자 다음 라운드 자동 진출까지 이어진다. "정확히 누가 안 왔는지"는 현장 판단이 필요한 예외라 사람이 1탭 확인만 한다(near-zero touch). 선수 MyMatches는 walkover_warn 방송 수신 시 호출/사전알림보다 우선하는 빨간 긴급 배너(강한 진동 패턴)로 "약 N분 내 미입장 시 부전승 처리" 를 띄우고, 정상 호출이 다시 오면 자동으로 내린다.

## 2026-07-09 — [C6/C1] 빈 코트 자동 투입 오케스트레이터 (무인 진행)

- **C6 빈코트 감시→다음경기 자동투입 + C1 사전알림·예상 호출시각 (필수/대, 운영 최대 공백)**
  - 파일: `src/lib/orchestrator.js`(신규), `src/lib/notify.js`, `src/pages/organizer/LiveDashboard.jsx`, `src/pages/player/MyMatches.jsx`
  - 요약: 지금껏 주최자가 경기마다 손으로 "호출" 버튼을 눌러야 했던 운영 수작업을 제거. 순수 함수 엔진 `orchestrator.js`(`buildCourtQueues`, `planAutoAdvance`)가 실시간 경기 상태에서 코트별 큐를 만들어 "지금 자동 호출할 경기(빈 코트 맨 앞) / 곧 호출 예고할 경기(다음 차례) / 코트 회전 기반 예상 호출시각"을 계산한다. LiveDashboard에 "무인 자동 진행" 스위치(기본 OFF, 안전)를 달아 켜면 실시간 `tournament_matches` 변경마다 오케스트레이터가 돌며 빈 코트에 다음 경기를 `callMatch`로 자동 호출하고, 다음 팀에겐 `callMatchSoon`(신규, notify.js)로 "곧 N번 코트 호출" 사전 알림을 1회 발송한다. 중복 호출/예고는 `calledIds`·`soonSentRef`로 차단, 다종목이 공유하는 코트는 진행 중 경기 조회로 중복 투입을 막는다. 자동 조치 내역은 화면에 로그로 투명 표시. 예정 경기 카드마다 "예상 호출 HH:MM쯤 · 앞 N경기"를 상시 표기(스위치 무관). 선수 MyMatches는 `match_soon` 방송을 받아 상단에 "곧 N번 코트로 호출돼요 · 앞에 N경기" 사전 배너(진동)를 띄우고, 실제 호출이 오면 자동으로 내린다. 실발송(웹푸시/알림톡/SMS)은 기존 human-gated 스텁 유지 — 인앱 실시간으로 데모 가능.

## 2026-07-09 — [C1] 경기 호출·알림 인프라 (오케스트레이션 레이어 착수)

- **C1 경기 호출(Match Call) end-to-end — 인앱 실시간 도달 (필수/대, 최우선 공백)**
  - 파일: `src/lib/notify.js`(신규), `supabase/migrations/013_notifications.sql`(신규), `src/pages/organizer/LiveDashboard.jsx`, `src/pages/player/MyMatches.jsx`
  - 요약: 지금껏 0건이던 알림 채널을 신설. `notify.js` 엔진이 호출을 3채널로 팬아웃한다 — (1) Supabase Realtime broadcast로 인앱 즉시 도달(스키마 불필요), (2) `notifications` 테이블에 지속 저장(감사·미확인 재알림·푸시 큐, 013 미적용 시 try/catch degrade), (3) 웹푸시/카카오 알림톡/SMS 외부발송은 `VITE_ENABLE_PUSH` 플래그+서버키 뒤의 human-gated 스텁(`dispatchExternal`, `// TODO(human-gated)`). 주최자 실시간 진행 화면(LiveDashboard)의 예정 경기에 "N번 코트로 선수 호출" 버튼을 달아 `callMatch`를 트리거(미응답 시 재호출 반복 가능, 호출 시각 표시). 선수 화면(MyMatches)은 자기 참가 대회 채널을 구독해 자기 경기 호출을 받으면 상단 고정 배너("지금 N번 코트로 입장하세요")+진동을 띄우고, 앱을 닫아 방송을 놓쳤어도 재진입 시 `fetchRecentCalls`로 최근 미확인 호출을 복구, 확인 시 `markCallRead`. 엔트리 교집합으로 수신 대상 정확 판정.

## 2026-07-09 — [MMR] 레이팅 신뢰도 점수 + 리더보드 등재 최소 요건

- **4-5 레이팅 신뢰도 점수 (DUPR Reliability 방식) (높음/중, 3단계)**
  - 파일: `src/lib/reliability.js`(신규), `src/components/ReliabilityBadge.jsx`(신규), `src/pages/player/Ranking.jsx`, `src/pages/player/Profile.jsx`
  - 요약: 스키마 변경 없이 기존 `mmr_history`(created_at·cert_level·tournament_id·game_mode)와 `mmr_games_played`만으로 '이 MMR이 실력을 얼마나 반영하는가'를 0~100%로 환산하는 엔진 신설. 4개 구성요소(경기량 40%·최근성 25%·다양성 20%·검증도 15%) 가중 합산 + 높음/보통/낮음 티어. 전국 랭킹 각 행에 신뢰도 배지, 프로필 MMR 탭에 신뢰도 게이지·구성요소 분해·정식 등재 안내 카드 추가.

- **4-13 리더보드 등재 최소 요건 + 강등 보호 UX — 등재 요건 부분 (중간/소, 3단계)**
  - 파일: `src/pages/player/Ranking.jsx`, `src/lib/reliability.js`
  - 요약: 최소 5경기·신뢰도 25% 미달 선수를 정식 순위에서 제외하고 '잠정(검증 중)' 섹션으로 분리(`isRanked`). 3경기 전승 유저가 전국 1위로 왜곡되는 문제 차단. 정식 등재 조건을 잠정 섹션·프로필에 명시.

## 2026-07-09 — [부정방지] 샌드배깅 탐지 + 파트너 자격 검사

- **4-3 샌드배깅(급수 사기) 방지 — 심사 화면 자동 플래그 (필수/중, 2단계, 부분)**
  - 파일: `src/lib/sandbag.js`(신규), `src/pages/organizer/EntryManagement.jsx`, `src/pages/player/TournamentDetail.jsx`
  - 요약: 서버 스키마 변경 없이 기존 데이터(mmr·mmr_games_played·official_grade·final_rank)만으로 신고 급수↔실제 MMR 괴리를 탐지하는 엔진(`getGradeFromMMR`, `assessSandbag`) 신설. 주최자 참가신청 심사 화면(EntryManagement)에 신청자별 MMR 실측 급수·과거 입상 이력(우승/입상 횟수)·미인증 여부를 표출하고, 신고 급수보다 실력이 높은 신청자를 '주의/샌드배깅 의심' 배지·상세 근거로 자동 플래그. 종목 상단에 의심 건수 요약. 경기 표본 부족(5경기 미만) 시 신뢰도 완화 처리. 선수 신청 화면에도 본인 MMR 실측 수준을 노출해 자기 괴리를 투명화.

- **2-6 파트너 자격·성별 검사 — 파트너 자격 검사 버그 수정 (높음/중, 1단계, 부분)**
  - 파일: `src/pages/player/TournamentDetail.jsx`
  - 요약: 기존에는 player1만 checkEligibility로 걸러 파트너를 통한 급수·MMR 상한 우회가 가능했음. 파트너에게도 동일 자격 검사를 적용하고, 이름 조회 시 미가입자(0건)·동명이인(2건 이상)·본인 지정을 각각 차단해 조용한 누락 버그를 제거.

## 2026-07-09 — [UX/UI] 실시간 신뢰성 + 동기화 표시 + PWA 설치

- **7-3 Supabase Realtime 신뢰성 보강 (필수/중, 1단계)**
  - 파일: `src/lib/supabase.js`, `src/lib/useOnline.js`, `src/pages/public/LiveScore.jsx`, `src/pages/organizer/CourtView.jsx`
  - 요약: LiveScore·CourtView 실시간 구독에 `subscribe(status)` 콜백을 붙여 끊김을 감지하고, 재연결(`SUBSCRIBED`) 시 전체 재조회(refetch-on-reconnect)로 그 사이 놓친 이벤트를 복구. 오프라인→온라인 복귀 시에도 즉시 재조회. supabase 클라이언트 heartbeat 주기 15초로 단축해 끊김을 더 빨리 감지.

- **7-6 동기화 상태 표시기 (높음/중, 1단계)**
  - 파일: `src/components/ConnectionStatus.jsx`(신규), `src/pages/public/LiveScore.jsx`, `src/pages/organizer/CourtView.jsx`, `src/pages/referee/Scoreboard.jsx`
  - 요약: 재사용 가능한 연결 상태 배지 컴포넌트 신설(실시간 연결됨 / 재연결 중… / 오프라인·전송 대기 + 마지막 갱신 시각). 공개 스코어보드·코트 관제·심판 점수판 상단/하단에 상시 표시해 '내 화면·입력이 서버와 연결돼 있는가'를 즉시 확인.

- **7-7 PWA 설치 유도 (높음/소, 2단계)**
  - 파일: `src/components/InstallPrompt.jsx`(신규), `src/pages/player/Home.jsx`
  - 요약: Android/Chrome `beforeinstallprompt`를 가로채 '앱 설치' 버튼 노출, iOS Safari는 공유→'홈 화면에 추가' 안내 오버레이 제공. 이미 설치(standalone)됐거나 사용자가 닫으면 30일간 재노출 안 함. 기존 manifest.json·sw.js 기반 위에 설치 진입점 완성.
