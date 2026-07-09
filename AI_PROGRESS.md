# AI 자동 개선 로그

> 자율 개선 에이전트가 완료한 로드맵 항목 기록. 이미 완료된 항목은 다시 하지 않는다.
> 각 항목: 날짜(UTC) · 로드맵 번호 · 변경 파일 · 한 줄 요약.

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
