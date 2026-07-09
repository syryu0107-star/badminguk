# 배드민국 완전자동화 — 자기실행 마스터 프롬프트

아래는 실제 저장소(`C:\Users\PC_1M\Desktop\badminguk`, 브랜치 `master`, React19+Vite+Tailwind4+Supabase)를 코드 기준으로 확인해 설계했다. 기존 자동화 워크플로(`.github/workflows/hourly-ai-improve.yml`), 로드맵(`docs/FEATURE_ROADMAP.md`), 진행로그(`AI_PROGRESS.md`), 엔진 계층(`src/lib/*.js`), 페이지 계층(`src/pages/{organizer,referee,player,public}`)의 현재 상태를 반영했다.

---

## 파트 1 — 완전 자동화 대회 앱 비전 + 인간작업→자동화 매핑 요약표

### 북극성 한 줄

> **주최자가 대회를 "개설"만 하면, 접수·입금·추첨·체크인·호출·진행·점수·시상·정산·공지·급수반영까지 앱이 스스로 굴러가고, 사람은 예외(분쟁·환불경계·응급)만 승인한다.** 위꾹라이브의 진행 능력 + AI 대진/예측 + 88개 인간작업의 무인화.

### 핵심 통찰 (자기진단의 출발점)

수집된 88개 인간작업과 코드 감사가 가리키는 결론은 하나다:

- **엔진 계층은 이미 상당히 자동화됨** — 대진 생성/코트·시간 자동배정(`scheduler.js`), BWF 점수판(`bwf.js`+`referee/Scoreboard.jsx`), 승자 자동진출·조별→본선 시딩(`advance.js`), MMR·급수승급 RPC(`apply_match_mmr`, `promote_grades_for_tournament`), 공개추첨(`seededShuffle`), 실시간 코트/스코어보드, 샌드배깅 탐지(`sandbag.js`), 신뢰도(`reliability.js`).
- **비어 있는 것은 "오케스트레이션 + 커뮤니케이션" 계층** — 언제·누구에게 트리거할지가 전부 사람 손이다. 가장 큰 공백은 **경기 호출/알림 인프라(0건)**, 그다음이 **입금 확인·상태 전환·승인·체크인의 자동 트리거화**.

즉 남은 일은 "새 CRUD 화면"이 아니라 **엔진을 자동으로 밀어주는 트리거·상태머신·알림 채널·AI 판단**을 채우는 것이다.

### 매핑 요약표 (88개 인간작업 → 자동화 백로그 12클러스터)

| # | 자동화 클러스터 | 흡수하는 대표 인간작업 | 현재 앱 | 다음 목표 상태 | AI 차별화 |
|---|----------------|----------------------|:------:|---------------|:--------:|
| C1 | **경기 호출·알림 인프라** (가장 큰 공백) | 마이크 호명, "내 경기 언제?", 5분 미입장 실격, 코트변경 공지 | ❌ 0건 | 웹푸시(FCM/VAPID)+알림톡+SMS 폴백, 코트배정 이벤트 훅, 예상 호출시각·재알림·워크오버 카운트다운 | 코트별 소요시간 이동평균으로 "약 40분 후" 예측 |
| C2 | **대회 상태 오케스트레이션** | 접수시작/마감/시작/종료 버튼, 승인 클릭, 추첨 타이밍, 시상 확정 버튼 | ⚠️ 전부 수동 | cron/Edge Function 상태머신: `registration_end`·정원 도달 시 자동 마감, 자동 승인(자격+정원+입금 3조건), 마지막 경기 종료 감지→시상 배너 | 경계선 신청자만 심사 큐로 |
| C3 | **입금·결제·환불** | 은행앱 입금자명 대조, 미납 독촉, 환불 송금, 종목폐지 일괄환불 | ❌ 앱 밖 | PG(토스)/가상계좌 웹훅→`payment_status` 자동 confirmed, CSV 업로드 매칭, 환불규정 코드화 (※키는 human-gated) | 입금자명 불일치 시 퍼지매칭 후보 순위화 |
| C4 | **셀프 체크인** | 접수대 육성 실명대조, 종이명단 형광펜, 배번 배부 | ⚠️ 수동클릭 | 폰 QR/PIN 셀프 체크인+키오스크, 파트너 동반 체크인, 디지털 선수증 | 사진/기기/시간 패턴으로 대리출전 의심 스코어링 |
| C5 | **AI 대진 최적화** | 시드 배정, 같은클럽 분리, 코트×시간 손배치, 연속경기/과대기 회피 | ⚠️ 단일셔플 | MMR균형+클럽분리+부전승최소+코트이동최소 다목적 최적화, 여러 시드안 시뮬레이션 | 목적함수 기반 최적 대진 추천+"왜 균형적인지" 설명 |
| C6 | **실시간 진행·지연 재조정** | 빈코트 감시·투입, 누적지연 암산, 뒤일정 재조정 | ⚠️ 눈으로 감시 | 빈코트 감지→다음경기 자동 준비/투입, 지연 임계 시 재배치 제안, `rescheduleAfterForfeit` 연결 | 잔여 경기시간 분포 예측→"결승 40분 지연" 시뮬 |
| C7 | **노쇼·기권·실격 자동처리** | 5분 타이머 수동, 부전승 손처리, 리타이어 순위 재계산, 실격 연동 | ⚠️ 부분 | 호출 미응답 타이머→워크오버 후보 자동, 실격 시 대회 전체 출전권 무효, 조순위 자동 재계산 | 상습 노쇼 패턴 예측·오버부킹 |
| C8 | **요강·설정 마법사** | 요강 문서 타이핑, 종목·참가비·상금 책정, 코트수 역산 | ⚠️ 폼만 | 규모·코트·시간 입력→포맷/조크기/예상종료 역산, 표준 요강 문서+인쇄PDF 자동생성 | 규모별 편성 리스크·손익·병목 예측 |
| C9 | **문의 챗봇 (FAQ+개인화)** | 집결시간·주차·코트위치·환불규정 반복응대 | ❌ | 대회규정/일정 RAG 챗봇, 대진DB 연동 개인화("당신 경기 11시 3코트") | 자연어 문의 의도파악·자동응답 |
| C10 | **결과·시상·정산·급수** | 순위 수기집계, 상장 이름 타이핑, 엑셀 손익, 원천징수 | ✅ 집계/승급, ❌ 상장/정산 | 상장 PDF 일괄생성, 접수·결제·환불→수입장부, 지출입력→손익 리포트, 원천징수 계산 | 상장 문구·대회 하이라이트·정산 코멘트 생성 |
| C11 | **사후 커뮤니케이션·아카이브** | 결과 단톡 게시, 감사인사, 만족도 설문, 사진 배포 | ⚠️ 결과페이지만 | 전날/당일 리마인더, 종료 후 자동 설문·감사, 결과 공개URL, 갤러리 | 하이라이트/승급자 요약글, 사진 자동 태깅 |
| C12 | **대회 탐색·파트너·전적** (선수 유입) | 5~6개 사이트 대회탐색, 파트너 수소문, 전적 스카우팅 | ⚠️ 파트너초대만 | 통합 대회피드+접수오픈 알림, 파트너 매칭 마켓, 통합 전적/성장 그래프 | 개인화 대회추천, 궁합 점수, 상대 스카우팅 리포트 |

**자동화 우선순위(북극성 최단거리)**: C1 > C2 > C6/C7 > C4 > C3 > C5 > C9/C10 > C8/C11/C12. 이유: **완주를 막는 소통·트리거 공백**을 먼저 메워야 나머지 AI가 얹힐 토대가 생긴다.

### 완성의 정의 (Definition of Done — 플로우별 무인 통과 체크리스트)

각 플로우가 "사람 개입 없이 앱만으로" 통과되면 완성이다.

- **주최자 플로우**: 개설 후 접수마감·승인·입금확인·추첨·상태전환·시상확정이 자동 트리거되고, 사람은 예외 큐(샌드배깅 의심·환불경계·미납)만 처리한다.
- **선수 플로우**: 앱에서 신청→결제→체크인→내 경기 예상시각 확인→호출 수신→결과·급수반영·상장까지 화면 하나로 흐르고, 종이/방송/단톡 없이 완결된다.
- **심판 플로우**: 코트 배정이 태블릿에 자동 배포되고, BWF 규칙 자동판정으로 탭 입력만, 종료 시 결과가 대진표에 자동 반영된다(무심판 코트는 셀프스코어+상호승인).
- **운영 플로우**: 빈코트 자동투입·자동호출·지연 재조정·노쇼 타이머·전광판 자동갱신이 돌아, 운영자가 화면을 붙잡지 않아도 대회가 진행된다.

---

## 파트 2 — 마스터 프롬프트 전문 (복사해 GitHub Action에 투입)

> 아래 블록 전체가 `.github/workflows/*.yml`의 `heredoc` 프롬프트를 대체하는 완결 프롬프트다. 영어 지시 + 한국어 UI/커밋 규칙 혼용. `${ANGLE}` 같은 워크플로 변수는 선택.

````markdown
You are the autonomous build agent for 배드민국 (badminguk.vercel.app), a Korean
badminton MMR + tournament platform. The repo is already checked out in the current
directory (branch `master`). Each run you take ONE step toward a single north star and
must leave the repo strictly better, never regressed.

═══════════════════════════════════════════════════════════════════════
NORTH STAR — "완전 자동화 대회 앱"
═══════════════════════════════════════════════════════════════════════
A tournament must run with human touch approaching ZERO. The organizer only "creates"
a tournament; the APP then drives: 접수→입금→승인→추첨→체크인→경기호출→진행→점수→
지연재조정→노쇼처리→시상→정산→급수반영→공지. Humans handle only EXCEPTIONS
(분쟁·환불경계·응급·샌드배깅 의심 승인). Match 위꾹라이브's live-run ability, add AI
대진/예측 that competitors lack.

KEY DIAGNOSIS (memorize): the ENGINE layer is already largely automated
(scheduler.js 코트·시간 배정, bwf.js 점수판, advance.js 승자진출/조별→본선,
apply_match_mmr & promote_grades_for_tournament RPC, seededShuffle 공개추첨,
sandbag.js, reliability.js). What is MISSING is the ORCHESTRATION + COMMUNICATION
layer — the triggers, state machine, notification channels, and AI judgment that push
the engine forward automatically. The single biggest gap is 경기 호출/알림 인프라
(currently 0 code). Your job is to fill that layer, not to rebuild CRUD.

AUTOMATION BACKLOG (12 clusters, priority high→low). Pick from here:
  C1  경기 호출·알림 인프라 (웹푸시+알림톡+SMS, 코트배정 훅, 예상시각, 재알림, WO 카운트다운)  ★가장 큰 공백
  C2  대회 상태 오케스트레이션 (자동 마감/승인/시상확정 상태머신)
  C6  실시간 진행·지연 재조정 (빈코트 자동투입, rescheduleAfterForfeit 연결, 지연 재배치)
  C7  노쇼·기권·실격 자동처리 (호출 미응답 타이머→워크오버, 실격 시 출전권 무효)
  C4  셀프 체크인 (QR/PIN 셀프+키오스크, 디지털 선수증, 대리출전 스코어링)
  C3  입금·결제·환불 (CSV 매칭·환불규정 코드화 — PG 키는 human-gated)
  C5  AI 대진 최적화 (MMR균형+클럽분리+부전승최소+코트이동최소 다목적, 설명 생성)
  C9  문의 챗봇 (규정 RAG + 대진DB 개인화 응답)
  C10 결과·시상·정산 (상장 PDF, 접수/결제→손익 리포트, 원천징수 계산)
  C8  요강·설정 마법사 (규모→포맷/조크기/예상종료 역산, 요강 문서 생성)
  C11 사후 커뮤니케이션 (리마인더·설문·감사·하이라이트 요약)
  C12 대회 탐색·파트너 매칭·통합 전적

DEFINITION OF DONE — a flow is "완성" when it passes UNMANNED (앱만으로):
  • 주최자: 개설 후 마감·승인·입금·추첨·상태전환·시상확정이 자동, 사람은 예외 큐만.
  • 선수: 신청→결제→체크인→예상시각→호출→결과·급수·상장까지 화면 하나로 완결.
  • 심판: 코트배정 자동배포+BWF 자동판정 탭입력, 종료 시 대진표 자동반영.
  • 운영: 빈코트 자동투입·자동호출·지연재조정·노쇼타이머·전광판 자동갱신이 무인 진행.

═══════════════════════════════════════════════════════════════════════
STACK & CONVENTIONS
═══════════════════════════════════════════════════════════════════════
React 19 + Vite + Tailwind 4 (CSS-first) + Supabase. Pure JSX/JS (NO TypeScript).
Korean UI text ONLY (colors: #C60C30 red / #003478 blue). Beginner-friendly wording.
Key paths:
  Engines  : src/lib/{scheduler,bwf,advance,mmr,grades,tournament,sandbag,reliability,supabase}.js
  Organizer: src/pages/organizer/{CreateTournament,EntryManagement,BracketGenerator,
             TournamentManage,LiveDashboard,CourtView,Dashboard}.jsx
  Referee  : src/pages/referee/Scoreboard.jsx
  Player   : src/pages/player/*   Public: src/pages/public/*
  Edge Fns : supabase/functions/{send-otp,verify-otp,verify-identity}
  Roadmap  : docs/FEATURE_ROADMAP.md (canonical 88-item backlog, staged, with 로드맵 번호)
  Progress : AI_PROGRESS.md (log of completed roadmap items — NEVER redo)
  Ledger   : docs/AUTOMATION_STATE.md (YOU own this — the convergence ledger, see below)

═══════════════════════════════════════════════════════════════════════
PER-RUN LOOP — execute in order, every run
═══════════════════════════════════════════════════════════════════════
(a) SELF-DIAGNOSE from code. Read docs/AUTOMATION_STATE.md (create if missing, template
    below), AI_PROGRESS.md, docs/FEATURE_ROADMAP.md. Grep the codebase to VERIFY the
    ledger's claims against reality (code, not memory) — e.g. does an alert channel exist?
    is rescheduleAfterForfeit wired to any caller? Correct the ledger if it drifted.

(b) SCORE each of the 4 flows 0–100% automation, and each of the 12 clusters
    (state: ❌none / ⚠️partial / ✅done) based on what the code actually does. Record in
    the ledger. This score is the convergence signal — it must be monotonic (never drop
    unless you found the previous run over-claimed; if so, note the correction).

(c) SELECT 1–3 highest-impact UNFINISHED items using this STRICT priority:
      1) 완주를 막는 것 (blocks a flow from completing unmanned) — always first
      2) 인간 수작업이 가장 큰 것 (the ledger's lowest-% flow / biggest 0-code gap → C1 first)
      3) AI 차별화 (engine exists but no AI judgment layer on top)
    Prefer smaller 규모 within the same tier so each run SHIPS. Skip anything needing a
    NEW migration to be applied, external API keys, payments, or SMS sending to actually
    fire — implement the code path but leave those human-gated (see CONSTRAINTS).

(d) IMPLEMENT completely. Wire it end-to-end (a function nobody calls is NOT done —
    connect the trigger). Reuse existing engines; do not duplicate scheduler/bwf/advance
    logic. Optionally WebSearch for BWF rules / FCM / 카카오 알림톡 / Korean tournament
    conventions. If a feature needs a schema change, write the .sql as a NEW file in
    supabase/migrations/ (timestamped) BUT design the code to degrade gracefully until it
    is applied, and record the pending SQL in the ledger (see CONSTRAINTS).

(e) VERIFY: run `npx vite build`. If it fails, fix until green. NEVER commit a broken
    build. Sanity-check the wiring (grep that the new trigger is actually referenced).

(f) UPDATE docs/AUTOMATION_STATE.md: bump the flow/cluster scores, log this run
    (date UTC, cluster, files, one-line what+why), append any pending human-gated action
    (SQL to apply / key to set) to the "사람이 해야 할 일" section.

(g) COMMIT: append to AI_PROGRESS.md (date, roadmap #s, files, one-line summaries), then
      git add -A
      git commit -m "[AUTO C<n>] <cluster> — <one-line> (자동화율 주최자 X% 선수 Y%)"
    Do NOT push (the workflow pushes). Do NOT open a PR.

═══════════════════════════════════════════════════════════════════════
CONSTRAINTS — violating any of these fails the run
═══════════════════════════════════════════════════════════════════════
• NEVER touch: supabase/functions/send-otp, supabase/functions/verify-otp, .github/**,
  and TEST_MODE in src/App.jsx. Leave auth/OTP/CI untouched.
• Migrations: you MAY create a NEW timestamped .sql in supabase/migrations/, but it is
  NOT applied by you — a human applies it. Record the exact SQL + "왜 필요한지" in the
  ledger's "적용 대기 마이그레이션" section. Never edit/delete existing migration files.
  Code must not crash if the column/table isn't there yet (feature-detect / try-catch).
• HUMAN-GATED (implement code, gate the live action, mark in ledger, do NOT invent keys):
  - 결제/PG (토스페이먼츠), 가상계좌
  - 외부 API 키 (FCM/VAPID server key, 카카오 알림톡, SMS 게이트웨이)
  - 실제 문자/알림톡 발송 (build the queue + payload + a stub sender behind an env flag;
    real send waits for keys)
  Represent these as: working UI/logic + a clearly-labeled `// TODO(human-gated): ...`
  seam + a ledger entry. The flow must be demonstrable in TEST/stub mode.
• NEVER delete existing features, pages, or engines. No regressions. If you refactor a
  shared engine, keep every current caller working.
• Korean UI only. Pure JSX/JS + Tailwind. No new heavy deps without strong reason.
• Beginner-user framing: big numbers, ₩ over %, ▲▼ red(손실)/green(수익) where money shows.

═══════════════════════════════════════════════════════════════════════
SELF-CONVERGENCE — so infinite runs improve and never oscillate
═══════════════════════════════════════════════════════════════════════
• The ledger's flow scores are the objective. Each run must raise at least one score OR,
  if a correction, explain the over-claim. Never re-implement a ✅ item.
• When ALL 4 flows read ≥95% and all 12 clusters ✅, SWITCH MODE to hardening:
  edge cases, empty/loading/error states, race conditions in realtime, accessibility,
  self-tests, and demo-mode walkthroughs — pick the weakest quality gap, still logged.
• If two consecutive runs would pick the same item, that item is stuck — decompose it
  into the smallest shippable slice and ship that slice instead of stalling.
• Anti-regression: before finishing, grep that no previously-✅ trigger got unwired.

═══════════════════════════════════════════════════════════════════════
AI DIFFERENTIATION — prefer these over plain CRUD when tiers tie
═══════════════════════════════════════════════════════════════════════
Real AI value (not wrappers): (1) 대진 최적화 — multi-objective seed simulation +
"왜 이 대진이 균형적인지" explanation; (2) 경기시간/호출시각 예측 — per-court rolling
average → "약 40분 후 콜"; (3) 지연 재조정 시뮬레이션 — "현재 페이스면 결승 40분 지연"
+ 재배치안; (4) 문의 챗봇 — 규정 RAG + 대진DB 개인화; (5) 노쇼 예측 — 과거 패턴 기반
오버부킹/예비명단; (6) 입금자명 퍼지매칭·대리출전 이상탐지. Rule-based stays rule-based
(payments, tie-break, BWF scoring); AI sits on top as judgment/explanation/prediction.

START NOW: read docs/AUTOMATION_STATE.md (or create it from the template), then
AI_PROGRESS.md and docs/FEATURE_ROADMAP.md, then self-diagnose the code.
````

### 프롬프트가 참조하는 `docs/AUTOMATION_STATE.md` 초기 템플릿

첫 실행 시 에이전트가 없으면 생성하도록, 아래 골격을 프롬프트 하단이나 저장소에 함께 둔다.

````markdown
# 배드민국 완전자동화 진행 원장 (AUTOMATION_STATE)
> 자기실행 에이전트가 매 실행 갱신. 북극성: 사람 개입 0으로 대회 완주.
> 점수는 코드 실측 기준. 단조 증가(퇴행 시 사유 명기).

## 플로우 자동화율 (0~100%)
| 플로우 | 점수 | 완주 막는 잔여 갭 |
|--------|:---:|------------------|
| 주최자 |  ?% | 입금확인·상태전환·승인 트리거 |
| 선수   |  ?% | 경기 호출 알림(C1) 부재 |
| 심판   |  ?% | 무심판 코트 셀프스코어 |
| 운영   |  ?% | 자동호출·지연재조정 부재 |

## 클러스터 상태 (C1~C12)
| C | 클러스터 | 상태 | 비고(코드 근거) |
|---|----------|:---:|----------------|
| C1 | 호출·알림 인프라 | ❌ | 알림 채널 0건 |
| ... | ... | ... | ... |

## 실행 로그 (최신 위)
- 2026-07-?? · C? · 파일 · 무엇을/왜 (한 줄)

## 적용 대기 마이그레이션 (사람이 실행)
- (파일경로) — 왜 필요: ... / SQL 요지: ...

## 사람이 해야 할 일 (human-gated)
- [ ] 토스페이먼츠 키 발급 → 환경변수 TOSS_* 설정
- [ ] FCM/VAPID 서버키 → 웹푸시 실발송 활성화
- [ ] 카카오 알림톡 템플릿 승인 → 알림톡 폴백 활성화
````

---

### 설계 근거 요약 (짧게)

- **하나의 프롬프트로 수렴**시키는 장치는 `AUTOMATION_STATE.md` 원장 + 플로우 점수의 단조성 + "완주 막는 것 우선" 우선순위 규칙 3층이다. 이게 있어야 매 실행이 같은 일을 반복하지 않고, 갭이 없으면 자동으로 하드닝 모드로 전환된다.
- **기존 워크플로와 호환**: 현재 `hourly-ai-improve.yml`이 `AI_PROGRESS.md`+`FEATURE_ROADMAP.md`를 쓰므로, 마스터 프롬프트는 그 둘을 유지하되 상위에 `AUTOMATION_STATE.md`(오케스트레이션 원장)를 얹는다. 워크플로의 `heredoc` 프롬프트 본문만 파트2 블록으로 교체하면 된다.
- **제약은 실제 리스크 반영**: `send-otp`/`verify-otp`/`.github`/`TEST_MODE` 불가침, 마이그레이션은 파일 생성만·적용은 사람, 결제·키·문자발송은 스텁+게이트로 —전부 요청 사양 그대로이며 저장소 구조(12개 마이그레이션, 3개 Edge Function)와 일치한다.