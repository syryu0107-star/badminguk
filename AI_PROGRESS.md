# AI 자동 개선 로그

> 자율 개선 에이전트가 완료한 로드맵 항목 기록. 이미 완료된 항목은 다시 하지 않는다.
> 각 항목: 날짜(UTC) · 로드맵 번호 · 변경 파일 · 한 줄 요약.

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
