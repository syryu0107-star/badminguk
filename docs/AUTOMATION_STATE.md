# 배드민국 완전자동화 진행 원장 (AUTOMATION_STATE)
> 자기실행 에이전트가 매 실행 갱신. 북극성: 사람 개입 0으로 대회 완주.
> 점수는 코드 실측 기준. 단조 증가(퇴행 시 사유 명기).

## 플로우 자동화율 (0~100%)
| 플로우 | 점수 | 완주 막는 잔여 갭 |
|--------|:---:|------------------|
| 주최자 | 80% | 무통장 입금 자동 매칭 ✅ / 디지털 상장 ✅ / 사후 공지·리마인더·감사·설문(C11) ✅ / **정산 손익·원천징수 리포트(C10)** ✅ — 참가비 수입−경비−상금 자동 손익+상금 원천징수 계산+리포트 인쇄. 잔여: PG 실결제(human-gated)·draft→open 자동 개설·시상 확정 무인 |
| 선수   | 76% | 셀프 체크인·디지털 선수증 ✅, 입금 확인 자동화 ✅, 결과·급수·상장 ✅, 대회 안내·공지함 수신 ✅, **문의 챗봇(C9)** ✅ — 규정·일정·참가비·내신청 자동응답으로 단톡방 문의 대체 / PG 카드결제 부재 |
| 심판   | 70% | 무심판 코트 셀프스코어 부재 |
| 운영   | 74% | 빈코트 자동투입·자동호출·사전알림·예상시각(관측 페이스 보정)·노쇼 타이머·지연 예측(현재 페이스면 N분 지연+예상 종료+재배치안) ✅ / 자동 부전승 확정·빈코트 실제 재배치 실행 미연결 |

## 클러스터 상태 (C1~C12)
| C | 클러스터 | 상태 | 비고(코드 근거) |
|---|----------|:---:|----------------|
| C1 | 경기 호출·알림 인프라 | ⚠️ | notify.js+orchestrator.js — 자동호출·사전알림(곧 호출)·예상 호출시각 end-to-end(LiveDashboard→MyMatches). 웹푸시/알림톡/SMS는 human-gated 스텁, WO카운트다운·재알림 타이머 미구현 |
| C2 | 대회 상태 오케스트레이션 | ⚠️ | stateMachine.js 신설 — 순수 판정 엔진. TournamentManage "무인 자동 진행" 스위치: 접수 마감 시각 경과/정원 충족 시 open→closed, 대회 당일+대진표 존재 시 closed→in_progress 자동 전환(추천 배너+원터치). EntryManagement "무인 자동 승인": 정상 신청 자동 승인, 샌드배깅 의심·입금 미확인·정원 초과만 사람 큐. draft→open(개설 공개)·시상 확정(무인)은 아직 수동 |
| C3 | 입금·결제·환불 | ⚠️ | `payment.js` 신설 — 무통장 입금 내역 붙여넣기→신청자명 퍼지매칭(Levenshtein+정규화)+금액 대조→`payment_status='confirmed'` 자동 처리. EntryManagement "입금 자동 매칭" 패널(자동확인/확인권장/미매칭 분류, 1탭 확인). 입금 확인이 auto-approval 입금대기 버킷을 비워 무인 승인까지 연결. PG 실결제(토스)·가상계좌·환불규정 코드화는 미구현·human-gated |
| C4 | 셀프 체크인 | ✅ | `checkin.js` 엔진 신설 — 선수 MyMatches "디지털 선수증" 카드에서 대회 당일/진행중 원터치 셀프 체크인(verified_method='self'). 실명인증 선수는 무인 완료, 미인증은 "본인확인 권장" 예외로만 노출. LiveDashboard 체크인 패널 실시간 반영(tournament_checkins 구독)+셀프/본인확인권장/신고 요약. 운영자 수동 체크인 병존. QR/PIN 키오스크·대리스코어링만 잔여 |
| C5 | AI 대진 최적화 | ⚠️ | seededShuffle 단일 셔플 + MMR 시드만 |
| C6 | 실시간 진행·지연 재조정 | ⚠️ | 빈코트 감시→다음경기 자동투입(orchestrator.planAutoAdvance) ✅. `analyzeDelay` 신설 — 진행 중 경기 경과로 관측 페이스 추정→예상 호출/종료 시각 보정, 계획(scheduled_time) 대비 지연 예측("현재 페이스면 약 N분 지연·예상 종료 HH:MM")+재배치안(빈코트 활용·페이스 안내)을 LiveDashboard 배너로 표출 ✅. 실제 재배치 실행(빈코트로 대기경기 이동)·rescheduleAfterForfeit(사전스케줄용, 라이브 미적용)은 아직 미연결 |
| C7 | 노쇼·기권·실격 자동처리 | ⚠️ | 노쇼 타이머 신설(orchestrator.planNoShow): 호출 후 미응답 경기를 waiting/warned/overdue 3단계로 판정 → 무인 진행 시 WALKOVER_WARN 자동 발송(선수 긴급 배너)+대시보드 카운트다운, overdue는 "노쇼 확인 대기" 패널 원터치 부전승(completeMatch walkover). "누가 안 왔는지"는 현장 예외라 사람 1탭 확인. 실격 출전권 무효·자동 부전승 확정은 미구현 |
| C8 | 요강·설정 마법사 | ⚠️ | 설정 폼만, 역산/문서생성 없음 |
| C9 | 문의 챗봇 | ⚠️ | `chatbot.js`+`HelpChat.jsx` 신설 — 규정 FAQ(점수/부전승/노쇼/MMR/샌드배깅/파트너/신청/환불) + 대회 데이터 개인화(일정·장소·참가비·접수마감·내 신청상태·자격·시상) 18개 주제 규칙기반 검색 응답. TournamentDetail 우하단 "문의" 챗봇. 외부 LLM 키 없이 완결(실LLM 연동은 future·human-gated) |
| C10 | 결과·시상·정산 | ✅ | 순위집계·급수승급 자동 + `certificate.js` 디지털 상장 + `settlement.js` 신설 — 정산·손익 완성. 참가비 입금(confirmed)만 수입 집계, 주최자 입력 경비·상금을 지출로 빼 순손익 자동 계산(환불·미수금은 손익 무영향·정보만), 상금 원천징수(4종 세율 프리셋: 없음/기타 22%/기타 4.4%/사업 3.3%)로 세무서 납부분·선수 실지급분 분리, TournamentManage "정산·손익" 패널(순손익 ▲▼·수입/지출·종목별·경비 입력 localStorage·정산 리포트 인쇄=PDF). 실PG 결제 연동만 human-gated |
| C11 | 사후 커뮤니케이션 | ⚠️ | `campaign.js` 신설 — 대회 상태·날짜만 보고 발송할 안내를 판정: 전날 리마인더(open/closed+D-1)·당일 안내(closed/in_progress+D-0)·종료 후 감사·만족도 설문. notify.js `sendCampaign`(3채널 팬아웃)+`fetchNotices`(공지함)·CAMPAIGN 타입. TournamentManage "대회 안내·공지" 패널: 무인 ON이면 때가 된 캠페인 자동 1회 발송(localStorage 재발송 차단), OFF면 원터치 "지금 보내기". 선수 MyMatches "공지·안내" 공지함(미읽음 배지·탭 읽음, 라이브 방송 즉시 수신). 하이라이트(개인 성적 요약)·실외부발송(문자/알림톡)은 미구현·human-gated |
| C12 | 대회 탐색·파트너·전적 | ⚠️ | 파트너 초대·랭킹 있음, 추천/매칭 없음 |

## 실행 로그 (최신 위)
- 2026-07-10 · C9 · `src/lib/chatbot.js`(신규)·`src/components/HelpChat.jsx`(신규)·`src/pages/player/TournamentDetail.jsx`
  · 문의 챗봇(C9 ❌→⚠️) — 유일하게 코드 0건(❌)이던 클러스터를 채움. 대회 단톡방에서 주최자가 손으로
    답하던 "언제 시작해요·어디서 해요·참가비 얼마·제 신청 됐어요·점수 규칙" 문의 응대(운영자 상시 수작업)를
    앱이 스스로 답하게 했다. 외부 LLM/키 없이 규칙 기반으로 완결(실LLM 연동은 future·human-gated). 순수 엔진
    `chatbot.js` 신설 — `normalize`(공백·문장부호 제거 후 부분일치, 한글 띄어쓰기 편차 방어), 18개 주제
    지식베이스(개인화 8: 일정/장소/참가비/접수마감/내신청상태/자격/시상 + 규정 FAQ 10: 입금/체크인/경기방식/
    점수(BWF 21점·듀스·골든포인트)/부전승/노쇼/MMR/샌드배깅/파트너/신청방법/환불), `matchTopic`(키워드 길이
    가중 최고점 주제 선택), `askBot(query, ctx)`(personal 주제는 대회 데이터로 답 생성·데이터 없으면 일반
    안내 폴백, 무매칭이면 fallback), `suggestedQuestions`(있는 정보만 추천 칩), 포맷 헬퍼(`fmtDate`·`fmtTime`·
    `fmtDateTime`·`fmtWon`). 재사용 컴포넌트 `HelpChat.jsx` — 480px 프레임 우하단 "문의" FAB→바텀시트 채팅
    (인사말·유저/봇 말풍선·추천 질문 칩·입력창), context prop으로 chatbot 호출. TournamentDetail에 대회
    데이터(tournament·categories·myEntries)를 실어 연결. 스키마·외부 키 불필요. 엔진 30개 시나리오
    (개인화·FAQ·폴백·빈ctx·헬퍼·추천) 자체 검증 통과, `npx vite build` green. (자동화율 선수 73%→76%)
- 2026-07-10 · C10 · `src/lib/settlement.js`(신규)·`src/pages/organizer/TournamentManage.jsx`
  · 정산 손익·원천징수 리포트(C10 ⚠️→✅) — 북극성 체인의 "정산" 단계가 코드 0건이라, 주최자는 참가비
    입금·경비·상금을 손으로 더해 손익과 원천징수를 계산해야 했다(주최자 완주 잔여 갭). 스키마·외부 키 없이
    기존 데이터(entry_fee·payment_status·payment_amount)만으로 자동 계산. 순수 엔진 `settlement.js` 신설 —
    `computeSettlement`(입금 확인 confirmed만 수입, 주최자 입력 경비+상금을 지출로 빼 순손익, 환불·미수금은
    손익 무영향 정보만·이중계상 방지, 종목별 분해), `WITHHOLDING_PRESETS`(원천징수 4종: 없음/기타 22%/
    기타 4.4%/사업 3.3%)+`presetByKey`, `formatWon`(₩ 천단위·음수), `settlementReportHtml`/`printSettlement`
    (인쇄 리포트=PDF 저장, XSS 이스케이프). TournamentManage에 "정산·손익" 패널 — 순손익 큰 숫자 ▲초록수익/
    ▼빨강손실, 수입/지출 2카드, 미수금·환불 안내, 종목별 수입, 경비 항목 추가/삭제(localStorage 기억),
    상금+원천징수 세율 선택→세무서 납부액·선수 실지급액, 정산 리포트 인쇄 버튼. 참가비 있는 대회 또는 경비·
    상금 입력 시 노출. 엔진 24개 시나리오(수입/미수금/환불/철회제외/지출/손익/원천징수/종목분해/클램프/포맷)
    자체 검증 통과, `npx vite build` green. 실PG 결제만 human-gated 유지. (자동화율 주최자 74%→80%)
- 2026-07-10 · C11 · `src/lib/campaign.js`(신규)·`src/lib/notify.js`·`src/pages/organizer/TournamentManage.jsx`·`src/pages/player/MyMatches.jsx`
  · 사후 커뮤니케이션(C11 ❌→⚠️) — 북극성 체인의 마지막 고리 "공지"가 코드 0건이라, 주최자가 단톡방에
    손으로 쓰던 리마인더·감사·설문이 앱 밖 수작업으로 남아 있었다. 순수 엔진 `campaign.js` 신설 —
    `dayDiff`(대회 날짜−오늘, 타임존 밀림 방지 위해 앞 10자만 파싱)·`localDateStr`·`planCampaigns`(상태×날짜로
    발송 후보 판정: open/closed+D-1→전날안내, closed/in_progress+D-0→당일안내, completed→감사+설문,
    각 문구는 제목·날짜·장소 삽입)·`pendingCampaigns`·발신기기 localStorage 재발송 차단
    (`loadSentCampaigns`/`markCampaignSent`, RLS상 주최자는 수신자 알림 조회 불가라 서버판정 대신)·
    `fetchCampaignRecipients`(approved 엔트리 player1·2 프로필 중복제거). notify.js에 `CAMPAIGN` 타입 4종·
    `NOTICE_TYPES`·`sendCampaign`(경기호출과 동일한 broadcast+persist+외부스텁 팬아웃, matchId 없음)·
    `fetchNotices`(공지함용 지속형 알림 조회)·`markNoticeRead`, `subscribeNotifications`가 CAMPAIGN 이벤트도
    수신하게 확장. TournamentManage에 "대회 안내·공지" 패널 — 무인 자동 진행 ON이면 useEffect가 때가 된
    캠페인을 스스로 1회 발송(autoSentRef+localStorage 중복차단), OFF면 캠페인별 "지금 보내기"/"보냄✓". 종료
    후에도 보이도록 action 게이팅 밖에 배치. 선수 MyMatches에 "공지·안내" 공지함 — 로드시 fetchNotices,
    미읽음 빨간 배지·탭 읽음(markNoticeRead), 라이브 방송 수신 시 즉시 상단 삽입(중복 방지). 스키마 변경 없음
    (기존 013 notifications 재사용, 미적용 시 broadcast만 도달하고 조용히 degrade). 엔진 17개 시나리오
    (날짜차·상태별 판정·sent 필터·문구) 자체 검증 통과, `npx vite build` green. 하이라이트(개인 성적 요약)·
    실외부발송은 human-gated 유지. (자동화율 주최자 70%→74%, 선수 70%→73%)
- 2026-07-10 · C10 · `src/lib/certificate.js`(신규)·`src/pages/player/Results.jsx`·`src/pages/organizer/LiveDashboard.jsx`
  · 디지털 상장 자동 생성 — 선수 완주(신청→…→결과·급수·**상장**)의 마지막 단계 "상장"이 코드 0건이라
    선수 플로우가 화면에서 완결되지 못했다. 순수 엔진 `certificate.js` 신설 — `certRankInfo`(순위→우승/
    준우승/3위 등급·메달·색, 시상 범위 밖=null), `koreanDate`(YYYY-MM-DD→"2026년 7월 10일"),
    `buildCertificate`/`buildCertificates`(대회·종목·수상팀·순위→발급번호·수여문 데이터, 시상 범위 자동 필터·
    순위 정렬), `certificatesHtml`(정식 상장 레이아웃 인쇄 문서, 이중 테두리·메달·수여문·주최 표기, XSS
    이스케이프, 다장 page-break, 자동 window.print), `printCertificates`(새 창 인쇄→브라우저 PDF 저장 가능,
    팝업차단/빈목록 시 false). 선수 Results "내 결과" 카드에 입상 시 "내 상장 받기·인쇄", 시상대에 "상장 모두
    인쇄"(N장), 주최자 LiveDashboard 시상 결과 패널에 "시상식용 상장 일괄 인쇄" 버튼 연결. 스키마·외부 키
    불필요(기존 QR 인쇄와 동일한 클라이언트 window.print 방식). 엔진 17개 시나리오(등급·날짜·발급번호·필터·정렬·
    HTML·XSS) 자체 검증 통과, `npx vite build` green. (자동화율 주최자 66%→70%, 선수 66%→70%)
- 2026-07-10 · C6 · `src/lib/orchestrator.js`(analyzeDelay 추가)·`src/pages/organizer/LiveDashboard.jsx`
  · 진행 페이스·지연 예측(AI 재조정 레이어) — 운영 완주를 막던 "계획대로 되고 있는지·언제 끝날지"를
    사람이 눈대중하던 공백을 메움. 지금껏 예상 호출 시각은 고정 30분 가정이라 경기가 밀리면 전부 어긋났다.
    순수 함수 `analyzeDelay(matches,{matchMinutes,now})` 신설 — (1) 진행 중 경기의 경과 시간으로 관측 페이스
    `observedMin` 추정(계획보다 오래 걸리면 보수적으로 반영), (2) 예정 시각 지났는데 미시작인 경기의
    최대 밀림 `scheduleDriftMin`, (3) 계획 종료 `plannedFinish`(최늦 scheduled_time+1경기), (4) 코트별 큐를
    관측 페이스로 굴린 실제 예상 종료 `projectedFinish`, (5) 지연 `delayMin`=projected−planned(≥0),
    (6) 코트 부하·유휴 코트 기반 `suggestions`(재배치안). LiveDashboard가 관측 페이스를 planAutoAdvance에
    되먹여 예상 호출 시각을 실시간 보정하고, "진행 페이스·지연 예측" 배너로 "현재 페이스면 약 N분 지연 ·
    예상 종료 HH:MM(계획 HH:MM) · 경기당 M분" + 재배치안을 표출(온트랙이면 초록 "계획대로"). 실시간 틱을
    진행 중 경기가 있으면도 돌게 확장(10초). 스키마 변경 없음(기존 actual_start·scheduled_time 사용). 엔진
    5개 시나리오 자체 검증 통과, `npx vite build` green. (자동화율 운영 68%→74%)
- 2026-07-10 · C3 · `src/lib/payment.js`(신규)·`src/pages/organizer/EntryManagement.jsx`
  · 무통장 입금 자동 매칭(C3 ❌→⚠️) — 주최자 완주를 막던 결정적 공백을 메움. payment_status 컬럼은
    존재하는데 'confirmed'로 바꾸는 코드 경로가 앱 어디에도 없어, 참가비 있는 신청은 auto-approval의
    "입금대기" 사람 큐에 영구히 갇혀 무인 승인이 불가능했다. 순수 엔진 `payment.js` 신설 —
    `normalizeName`(괄호·꼬리숫자·공백 제거), `parseAmount`, `nameSimilarity`(정규화 동일=1·포함=0.9·
    Levenshtein 비율), `parseDeposits`(은행/토스 붙여넣기를 [{name,amount}] 로 관대 파싱, 날짜 오인식 방지),
    `matchDeposits`(참가비>0·미확인 신청 ↔ 입금 그리디 매칭: 유사도≥0.85+금액충족=confirmed, 0.6~0.85·
    금액부족·경합=review, 입금 1건=신청 1건 중복배정 방지, 미매칭 신청·미사용 입금 분리). EntryManagement에
    "입금 자동 매칭" 접이식 패널 추가 — 내역 붙여넣기→자동확인/확인권장/미매칭 3분류 요약→"자동 확인 N건 입금
    완료 처리" 일괄 버튼(payment_status='confirmed') + review 행별 1탭 개별 확인 + 미사용 입금(오입금/미신청)
    안내. 입금 확인이 planAutoApprovals의 payment 버킷을 비워 무인 자동 승인까지 자연 연결(별도 트리거 불필요).
    스키마 변경 없음(기존 payment_status·entry_fee 사용). 엔진 20개 시나리오 자체 검증 통과, `npx vite build`
    green. PG 실결제·환불규정은 human-gated 유지. (자동화율 주최자 58%→66%, 선수 63%→66%)
- 2026-07-09 · C4 · `src/lib/checkin.js`(신규)·`src/pages/player/MyMatches.jsx`·`src/pages/organizer/LiveDashboard.jsx`
  · 셀프 체크인(C4 ⚠️→✅) — 선수 완주를 막던 "체크인은 운영자만 손으로 클릭" 공백을 메움. 순수함수
    `getCheckinWindow`(대회 date/status로 before/open/ended 창 판정: 당일 또는 in_progress면 체크인 가능)·
    `assessSelfCheckin`(실명인증 선수=무인 완료, 미인증=현장 본인확인 권장)·`summarizeCheckins`(done/self/
    flagged/reviewNeeded 집계) + Supabase 헬퍼(`selfCheckin` upsert method='self', `fetchMyCheckins`). 선수
    MyMatches 상단에 "체크인 · 디지털 선수증" 카드(참가 확정 대회 단위, 실명·인증배지·종목·장소) — 창이 열리면
    원터치 "지금 셀프 체크인", 완료 시 초록 확정+시각. 주최자 LiveDashboard 체크인 패널은 tournament_checkins를
    실시간 구독해 선수 셀프 체크인을 무인 반영하고, 상단 요약(완료 N/전체·셀프·본인확인 권장·신고)+행별 "셀프 완료"·
    "본인확인 권장"(셀프+미인증) 배지 노출. 스키마 변경 없음(기존 verified_method에 'self' 값만 추가 사용). 엔진
    7개 시나리오 자체 검증 통과, `npx vite build` green. (자동화율 선수 55%→63%, 주최자 56%→58%)
- 2026-07-09 · C2 · `src/lib/stateMachine.js`(신규)·`src/pages/organizer/TournamentManage.jsx`·`src/pages/organizer/EntryManagement.jsx`
  · 대회 상태 오케스트레이션 착수(C2 ❌→⚠️) — 주최자 최대 수작업이던 "접수 마감·대회 시작·참가 승인"을
    앱이 스스로 판정. 순수 엔진 `planTournamentState`(open→closed: 마감시각 경과 or 전 종목 정원 충족 /
    closed→in_progress: 대회 당일+대진표 존재 / in_progress→completed: 실경기 전부 완료는 추천만, 무인 아님)
    와 `planAutoApprovals`(applied 신청을 auto/review/payment/capacity로 분류 — 샌드배깅 의심·입금 미확인·
    정원 초과만 사람 큐)를 신설. TournamentManage에 "무인 자동 진행" 스위치(기본 OFF, localStorage) — 20초 틱으로
    마감시각/당일 도래 감지, ON이면 안전 전환을 1회 자동 적용, OFF여도 추천 배너+"지금 전환" 원터치. EntryManagement에
    "무인 자동 승인" 스위치+분류 요약(자동승인/의심검토/입금대기/정원초과)+"안전한 N건 자동 승인" 버튼. 엔진 5개
    시나리오 + 승인 4버킷 자체 검증 통과. 스키마 변경 없음(기존 registration_end·max_teams·entry_fee·payment_status 사용).
    (자동화율 주최자 42%→56%)
- 2026-07-09 · C7 · `src/lib/orchestrator.js`(planNoShow 추가)·`src/lib/notify.js`(callWalkoverWarn 추가)·LiveDashboard·MyMatches
  · 노쇼(호출 미응답) 타이머 신설 — 지금껏 호출 후 안 오면 대회가 무한 정지(사람이 손으로 부전승)했던 최대 운영 공백을
    메움. 순수함수 `planNoShow`가 호출 시각(calledIds) 대비 경과로 waiting/warned/overdue 3단계 판정. LiveDashboard가
    10초 틱으로 카운트다운 갱신하고, 무인 진행 ON이면 warned 진입 시 `callWalkoverWarn`(WALKOVER_WARN, 기존 미사용 타입)
    을 1회 자동 발송(warnedRef 중복차단, 재호출 시 초기화). overdue 경기는 "노쇼 확인 대기" 패널에 카운트다운·원터치
    부전승(팀별)·다시 호출로 노출 → 부전승은 completeMatch(walkover, MMR 미반영)로 대진 자동 진출. "누가 안 왔는지"만
    현장 예외로 1탭 확인. 선수 MyMatches는 walkover_warn 수신 시 최우선 빨간 긴급 배너(강한 진동)로 "N분 내 미입장 시
    부전승" 표시. C7 타이머·경고 ✅(자동 부전승 확정만 잔여). (자동화율 운영 58%→68%, 선수 53%→55%)
- 2026-07-09 · C6/C1 · `src/lib/orchestrator.js`(신규)·`src/lib/notify.js`·LiveDashboard·MyMatches
  · 빈코트 자동투입 오케스트레이터: 코트가 비면 다음 경기 자동 호출 + 다음 팀 "곧 호출" 사전알림
    + 코트 회전 기반 예상 호출시각. LiveDashboard "무인 자동 진행" 스위치(기본 OFF, 자동 조치 로그),
    선수 MyMatches 사전알림 배너. 다종목 공유 코트 중복투입 방지(진행중 코트 조회). C6 빈코트 자동투입 ✅.
    (자동화율 운영 38%→58%, 선수 50%→53%)
- 2026-07-09 · C1 · `src/lib/notify.js`(신규)·`013_notifications.sql`(신규)·LiveDashboard·MyMatches
  · 경기 호출 인프라 착수: 주최자 "선수 호출" 버튼 → 3채널 팬아웃(인앱 실시간 방송·지속 저장·외부발송 스텁)
    → 선수 MyMatches 실시간 호출 배너+진동+놓친 호출 복구. C1 ❌→⚠️. (자동화율 주최자 40% 선수 50%)
- 2026-07-10 · 초기화 · 이 원장 생성 (마스터 프롬프트 도입과 함께)

## 적용 대기 마이그레이션 (사람이 실행)
- [x] `supabase/migrations/013_notifications.sql` — ✅ 2026-07-10 적용 완료 (notifications 테이블 + RLS 3정책 확인)

## 사람이 해야 할 일 (human-gated)
- [ ] 솔라피 잔액 충전 확인 → 문자 OTP 실발송 (키·발신번호는 Supabase 시크릿에 등록됨)
- [ ] 토스페이먼츠 키 발급 → 결제 활성화
- [ ] FCM/VAPID 서버키 발급 → 웹푸시 실발송 활성화
- [ ] 카카오 알림톡 템플릿 승인 → 알림톡 폴백 활성화
- [ ] TEST_MODE 해제 결정 (실로그인 전환)
- [ ] 013 마이그레이션 적용 후 `VITE_ENABLE_PUSH=true` + FCM/알림톡/SMS 키 등록 → notify.js `dispatchExternal` 실발송 활성화 (현재는 인앱 실시간 방송만 도달)
- [ ] (C11) 사후 설문 URL(구글폼 등) 연동 — 현재 설문 캠페인은 앱 내 안내 문구만. 외부 설문 링크는 대회 설정에 URL 필드 추가 후 payload에 실어 발송하면 됨(human-gated, 링크 준비 필요)
- [ ] (C9 선택) 문의 챗봇 실LLM 연동 — 현재는 규칙 기반(정적 규정 KB + 대회 데이터 검색)으로 완결 동작. 자유질의 이해도를 높이려면 Claude API 키를 발급해 `askBot` 폴백을 LLM 호출로 대체(규정 KB를 시스템 프롬프트에, 대회 ctx를 컨텍스트로 주입). 키·비용 발생이라 human-gated.
- [ ] (다음 목표·심판 70%) 무심판 코트 셀프 스코어 — 선수가 자기 폰으로 `/referee/:matchId`를 열어 점수를 입력하려면 `tournament_matches` UPDATE가 필요한데 현재 RLS는 주최자(001 "주최자 관리" FOR ALL)만 허용. 참가 선수도 자기 경기의 live_*·status를 쓰도록 하는 RLS 정책 마이그레이션이 선행돼야 실제 발화 가능(엔진/UI는 그 후 추가). 이 갭이 심판 플로우의 유일한 잔여 공백.
