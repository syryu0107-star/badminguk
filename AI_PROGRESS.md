# AI 자동 개선 로그

> 자율 개선 에이전트가 완료한 로드맵 항목 기록. 이미 완료된 항목은 다시 하지 않는다.
> 각 항목: 날짜(UTC) · 로드맵 번호 · 변경 파일 · 한 줄 요약.

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
