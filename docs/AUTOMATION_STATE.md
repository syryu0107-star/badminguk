# 배드민국 완전자동화 진행 원장 (AUTOMATION_STATE)
> 자기실행 에이전트가 매 실행 갱신. 북극성: 사람 개입 0으로 대회 완주.
> 점수는 코드 실측 기준. 단조 증가(퇴행 시 사유 명기).

## 플로우 자동화율 (0~100%)
| 플로우 | 점수 | 완주 막는 잔여 갭 |
|--------|:---:|------------------|
| 주최자 | 89% | **요강·설정 마법사(C8)** ✅ — 개설 시 정원(예상 팀 수)으로 대진 방식 자동 추천(규모→리그/조별+토너먼트·조 크기)·경기 수·예상 소요·예상 종료 시각 역산(코트 수 반영)·요강 문서(PDF) 자동 생성. 무통장 입금 자동 매칭 ✅ / 디지털 상장 ✅ / 사후 공지·리마인더·감사·설문(C11) ✅ / 정산 손익·원천징수 리포트(C10) ✅ / 시상 확정 무인(C2) ✅ / **AI 균형 추첨(C5)** ✅ — 조별 포맷 무작위 편성 시 후보 16개를 시뮬레이션해 조별 평균 MMR 편차 최소 대진 자동 선택 + "왜 균형적인지" 설명. 잔여: PG 실결제(human-gated)·draft→open 자동 개설(공개는 개설자 판단으로 남김)·클럽분리(프로필에 클럽 필드 없음) |
| 선수   | 88% | **대회 탐색 추천(C12)** ✅ — "대회 찾기" 화면 상단에 "🎯 나에게 맞는 대회" 개인화 추천(로그인 시): 내 급수로 참가 가능한 접수중 대회를 자주 가던 지역·접수 마감 임박순으로 골라, 근거 칩(참가 가능 종목 수·자주 가던 지역·마감 D-day)과 함께 노출(검색-only였던 탐색에 개인화 추가로 C12 마지막 조각 마감). **통합 전적(C12)** ✅ — 프로필 "대회 커리어" 탭에 전 대회 실제 경기 기반 통합 전적(총 승패·승률 게이지·세트/점수 득실·풀세트 접전·부전 포함)과 "상대 전적"(자주 만난 상대별 W/L, head-to-head) 자동 집계. 셀프 체크인·디지털 선수증 ✅, **파트너 추천(C12)** ✅ — 복식 신청 시 지난 대회에 함께 나간 파트너 중 이 종목 자격을 통과하는 사람을 "다시 초대" 원터치 카드로 추천(전화번호·이름 검색만 있던 신청 마찰 완화), **입금 안내(C3)** ✅ — 참가비 있는 미입금 신청에 MyMatches "입금 안내" 카드(금액·본인 실명 입금자명 복사·단계 안내)로 "얼마를 어떤 이름으로 넣어야 앱이 자동 확인하는지"를 처음으로 화면에 명시(주최자 C3 자동매칭이 player1/2 실명 대조 → 선수가 실명으로 넣게 유도해 무인 입금확인율↑), 입금 확인 자동화 ✅, 결과·급수·상장 ✅, 대회 안내·공지함 수신 ✅, **문의 챗봇(C9)** ✅ — 규정·일정·참가비·내신청 자동응답으로 단톡방 문의 대체, **호출 재알림(C1)** ✅ — 호출을 놓친 선수에게 경고 전 waiting 구간에서 45초 간격 최대 2회 자동 재호출(앱 잠깐 껐다 켠 선수도 다시 수신), **개인 하이라이트 요약(C11)** ✅ — 대회 종료 후 결과 화면에서 내 경기 회고(총 경기·승패·세트/점수 득실·명장면·MMR 변동+격려·다음 목표·공유)를 앱이 자동 생성해 선수 완주에 "회고" 종점 추가 / 잔여: 계좌번호 직접 표시(주최자 계좌 필드 스키마 부재·human-gated)·PG 카드결제 부재 |
| 심판   | 82% | **코트별 심판 모드(도달 경로)** ✅ — 심판이 담당 코트를 고르면 그 코트의 현재/다음 경기가 나오고, 원터치로 BWF 점수판(/referee/:matchId) 진입, 경기 종료 시 다음 경기가 실시간 구독으로 자동 배포. BWF 자동판정 탭입력·종료 시 대진표 자동반영은 기존 ✅. **자동 심판 콜(판정 자동화)** ✅ — `bwf.matchCall`이 현재 점수에서 골든포인트/매치포인트/게임포인트/듀스를 자동 판정해 점수판에 상황 배너를 띄우고(새로고침에도 점수 파생이라 유지), 헤더 스피커 토글을 켜면 매 득점마다 SpeechSynthesis(브라우저 TTS·키 불필요)로 "서버 점수 대 리시버 점수 + 매치 포인트/듀스…", 게임/경기 종료·인터벌·기권까지 한국어로 읽어 준다(비전문가 동호인 심판이 규칙을 몰라도 정확한 콜). 잔여: 무심판 코트 셀프스코어(선수 자가 점수 입력 — tournament_matches UPDATE RLS 확장 필요·human-gated) |
| 운영   | 87% | 빈코트 자동투입·자동호출·사전알림·예상시각(관측 페이스 보정)·노쇼 타이머·**호출 재알림(무응답 자동 재호출)** ✅·지연 예측·**빈코트 실제 재배치 실행(C6)** ✅·**노쇼 자동 부전승 확정(C7)** ✅·**팀 대회 이탈·실격 일괄 부전 처리(C7)** ✅ — 실격·부상으로 빠지는 팀을 1번 고르면 남은 경기(조별 잔여+녹아웃 현재)를 모두 walkover(MMR 미반영)로 자동 확정+상대 자동 진출→미완료 경기가 남아 finalize를 막던 반복 수작업 제거. 잔여: 애매한 노쇼(둘 다 체크인=코트만 안 옴 / 더블 노쇼)만 사람 1탭·rescheduleAfterForfeit(사전스케줄용, 라이브 미적용) |

## 클러스터 상태 (C1~C12)
| C | 클러스터 | 상태 | 비고(코드 근거) |
|---|----------|:---:|----------------|
| C1 | 경기 호출·알림 인프라 | ⚠️ | notify.js+orchestrator.js — 자동호출·사전알림(곧 호출)·예상 호출시각·**WO 카운트다운(planNoShow warned/overdue)**·**호출 재알림 타이머** ✅ end-to-end(LiveDashboard→MyMatches). 재알림: `planNoShow`가 waiting 구간(경고 전)에서 무응답 경기를 `toRecall`로 분류(recallAfterSec 45s·recallEverySec 45s·recallMaxCount 2), 무인 진행 ON이면 callMatch를 자동 반복(recalledRef 중복차단, calledIds 원 호출시각 불변→부전승 카운트다운 그대로). 잔여: 웹푸시/알림톡/SMS 실발송만 human-gated 스텁 |
| C2 | 대회 상태 오케스트레이션 | ⚠️ | stateMachine.js 순수 판정 엔진. TournamentManage "무인 자동 진행": open→closed(마감/정원)·closed→in_progress(당일+대진표) 자동. EntryManagement "무인 자동 승인": 정상 신청 자동, 예외만 큐. **in_progress→completed 무인 확정** ✅ — `planAutoFinalize`(순수·유예 판정) + LiveDashboard 무인 진행 ON이면 전 종목 종료 후 3분 유예(점수정정 창) 지나 finalizeTournament 자동 실행(순위·급수·상장 데이터 확정)+승급 축하 배너, "지금 시상 확정" 원터치. 잔여: draft→open(개설 공개)만 수동(개설자 의도적 판단으로 보류) |
| C3 | 입금·결제·환불 | ⚠️ | `payment.js`(주최자 자동매칭)+`deposit.js`(선수 입금 안내) — 무통장 입금 루프가 양쪽에서 완결. 주최자: 입금 내역 붙여넣기→신청자명 퍼지매칭(Levenshtein+정규화)+금액 대조→`payment_status='confirmed'` 자동, EntryManagement "입금 자동 매칭" 패널(자동확인/확인권장/미매칭, 1탭). 선수: `deposit.js`+MyMatches "입금 안내" 카드 — 참가비 있는 미입금 신청에 금액·**본인 실명 입금자명(복사 버튼)**·3단계 안내 노출로 "실명으로 입금→앱이 자동 확인"을 처음 명시(matchDeposits가 player1/2 실명 대조하므로 매칭율 직결). 입금 확인이 auto-approval 입금대기 버킷을 비워 무인 승인까지 연결. 잔여: 주최자 계좌번호 표시(tournaments에 계좌 필드 없음·마이그레이션 human-gated)·PG 실결제(토스)·가상계좌·환불규정 코드화 |
| C4 | 셀프 체크인 | ✅ | `checkin.js` 엔진 신설 — 선수 MyMatches "디지털 선수증" 카드에서 대회 당일/진행중 원터치 셀프 체크인(verified_method='self'). 실명인증 선수는 무인 완료, 미인증은 "본인확인 권장" 예외로만 노출. LiveDashboard 체크인 패널 실시간 반영(tournament_checkins 구독)+셀프/본인확인권장/신고 요약. 운영자 수동 체크인 병존. QR/PIN 키오스크·대리스코어링만 잔여 |
| C5 | AI 대진 최적화 | ⚠️ | `drawOptimizer.js` 신설 — 조별 포맷(2개 이상 조·MMR 있음) 무작위 편성 시 `optimizeDraw`가 후보 씨드 16개를 generatePools로 시뮬레이션→`scoreDraw`(조별 평균 MMR 편차 spread + 조크기 편차 페널티)로 채점→가장 고른 대진 자동 선택. `explainDraw`가 "왜 균형적인지"(가장 센/약한 조 평균·후보 대비 개선폭·조별 평균 배지) 초보용 설명 생성. BracketGenerator "AI 균형 추첨" 토글(기본 ON, 무작위 편성 시 노출)+완료 화면 설명 카드+조별 평균 MMR 배지. 고른 씨드 저장으로 공개추첨 재현성 유지. 시드 켜짐이면 스네이크가 이미 균형이라 seeded 설명만. 잔여: 클럽분리(프로필 클럽 필드 없음·human-gated)·부전승최소(pool 크기 균형은 반영, 녹아웃 시드 최적화는 미적용)·코트이동최소(C6 planRebalance가 별도 담당) |
| C6 | 실시간 진행·지연 재조정 | ✅ | 빈코트 감시→다음경기 자동투입(planAutoAdvance) ✅. `analyzeDelay` 지연 예측·재배치안 배너 ✅. **`planRebalance` 신설(빈코트 실제 재배치)** ✅ — 유휴 코트(진행중·대기 없음+타종목 미사용)로 과부하 코트(진행중+대기≥1 또는 대기≥2)의 대기 경기를 court_number UPDATE로 실제 이동. 옮긴 경기는 유휴 코트 맨 앞이 돼 planAutoAdvance가 자동 호출→무인 완결. 중복 출전(팀이 경기 중) 방지·다종목 사용 코트 제외·경합 시 status='scheduled' 조건부 UPDATE. 무인 ON이면 runOrchestrator에서 자동, OFF면 추천 패널 원터치. rescheduleAfterForfeit(사전스케줄 전용)만 라이브 미적용(설계상 별개) |
| C7 | 노쇼·기권·실격 자동처리 | ✅ | 노쇼 타이머(orchestrator.planNoShow): 호출 후 미응답 경기를 waiting/warned/overdue 3단계로 판정 → 무인 진행 시 WALKOVER_WARN 자동 발송(선수 긴급 배너)+대시보드 카운트다운. **자동 부전승 확정(checkin.assessNoShowResolution)** ✅ — C4 셀프 체크인 데이터로 "누가 안 왔는지"를 확신할 수 있으면(한 팀 전원 체크인=현장에 있음 + 상대 전원 미체크인=오지 않음) 무인 진행 ON일 때 overdue 진입 시 자동 부전승 확정(completeMatch walkover→승자 자동 진출·MMR 미반영), autoResolvedRef 중복차단·실패 시 재시도. 애매한 경우(둘 다 체크인=코트만 안 옴 / 둘 다 미체크인=더블 노쇼 / 부분 체크인)만 "노쇼 확인 대기" 패널에서 체크인 힌트 배지+추천 버튼과 함께 사람 1탭. **실격·출전권 무효 자동처리(advance.planTeamForfeit/forfeitTeamRemaining)** ✅ — LiveDashboard "팀 대회 이탈·실격 처리" 패널에서 빠질 팀 1탭→그 팀이 낀 미완료 경기를 상대 정해진 것은 walkover 부전패(MMR·득실 미반영, completeMatch로 상대 자동 진출), 상대 미정(녹아웃 TBD 슬롯)은 슬롯 비우기로 분류해 일괄 처리. |
| C8 | 요강·설정 마법사 | ✅ | `planWizard.js` 신설 — 규모→포맷/조크기 역산 + 예상종료 계산 + 요강 문서. `distributePools`(고른 조 분배)·`estimateMatches`(포맷별 실경기 수 역산: RR=nC2·SE=n-1+3위전·PK=조별합+advancers-1)·`defaultMatchMinutes`(점수제·판수 기반)·`estimateSchedule`(조별 코트 병렬+녹아웃 라운드 순차로 소요·예상 종료 시각)·`estimateTournament`(전 종목 합산)·`recommendSetup`(≤5 리그/≤8 4팀조/9+ 최적 조크기 자동)·`buildGuidelines`/`guidelinesHtml`/`printGuidelines`(요강 6섹션 인쇄=PDF·XSS 이스케이프). CreateTournament: 대진 설정 펼침에 "AI 대회 설계 도우미"(추천이 현재와 다르면 헤드라인·이유·"이 추천 적용"+정원 기준 예상 경기 수·소요·종료), 하단 "예상 진행·요강" 섹션(전 종목 합산+요강 PDF). 엔진 30개 시나리오 자체 검증 통과. 스키마·외부 키 불필요 |
| C9 | 문의 챗봇 | ⚠️ | `chatbot.js`+`HelpChat.jsx` 신설 — 규정 FAQ(점수/부전승/노쇼/MMR/샌드배깅/파트너/신청/환불) + 대회 데이터 개인화(일정·장소·참가비·접수마감·내 신청상태·자격·시상) 18개 주제 규칙기반 검색 응답. TournamentDetail 우하단 "문의" 챗봇. 외부 LLM 키 없이 완결(실LLM 연동은 future·human-gated) |
| C10 | 결과·시상·정산 | ✅ | 순위집계·급수승급 자동 + `certificate.js` 디지털 상장 + `settlement.js` 신설 — 정산·손익 완성. 참가비 입금(confirmed)만 수입 집계, 주최자 입력 경비·상금을 지출로 빼 순손익 자동 계산(환불·미수금은 손익 무영향·정보만), 상금 원천징수(4종 세율 프리셋: 없음/기타 22%/기타 4.4%/사업 3.3%)로 세무서 납부분·선수 실지급분 분리, TournamentManage "정산·손익" 패널(순손익 ▲▼·수입/지출·종목별·경비 입력 localStorage·정산 리포트 인쇄=PDF). 실PG 결제 연동만 human-gated |
| C11 | 사후 커뮤니케이션 | ⚠️ | `campaign.js` 신설 — 대회 상태·날짜만 보고 발송할 안내를 판정: 전날 리마인더(open/closed+D-1)·당일 안내(closed/in_progress+D-0)·종료 후 감사·만족도 설문. notify.js `sendCampaign`(3채널 팬아웃)+`fetchNotices`(공지함)·CAMPAIGN 타입. TournamentManage "대회 안내·공지" 패널: 무인 ON이면 때가 된 캠페인 자동 1회 발송(localStorage 재발송 차단), OFF면 원터치 "지금 보내기". 선수 MyMatches "공지·안내" 공지함(미읽음 배지·탭 읽음, 라이브 방송 즉시 수신). **개인 하이라이트 요약** ✅ — `highlight.js` 신설(`computePlayerStats`·`buildPlayerHighlight`·`highlightShareText`), 대회 종료 후 Results "내 대회 하이라이트" 카드(총 경기·승패·세트/점수 득실·풀세트 접전·명장면(3점차 이내)/최다점수차 완승·MMR 총변동(mmr_history 합산·미적용 시 생략)+순위별 헤드라인·격려·다음 목표+스탯 칩+공유(navigator.share/클립보드), 규칙기반·키/스키마 불필요). 잔여: 실외부발송(문자/알림톡)만 human-gated |
| C12 | 대회 탐색·파트너·전적 | ✅ | `discover.js`+`partners.js`+`record.js` — **대회 탐색 추천** ✅ + **파트너 매칭** ✅ + **통합 전적 뷰** ✅. **대회 탐색 추천(`discover.js`)**: `regionTokens`(venue·주소에서 17시도+시/군/구 세밀 토큰 추출, 광역시/특별시 중복 제외)·`preferredRegions`(내 참가 이력 대회의 지역 빈도 집계)·`ddayOf`(로컬 자정 기준 D-day)·`recommendTournaments`(접수중·미신청·미래 대회 중 급수 참가 가능 종목이 있는 것만 골라 지역 매칭·마감 임박·대회일 근접으로 점수화, 근거 배열 반환). 자격 판정은 lib/grades.js로 승격한 공용 `checkEligibility`를 fitOf로 주입(신청 화면과 100% 동일 로직·중복 0). Tournaments.jsx가 로그인 선수의 프로필·참가 이력을 1회 로드→"🎯 나에게 맞는 대회" 카드+근거 칩(급수 파랑/지역 초록/마감 빨강·주황) 노출(전체 탭·검색 없을 때만, 실패 시 검색만 degrade). 파트너 매칭·통합 전적은 아래 유지. 통합 전적(`record.js`): `computeCareerRecord`가 내가 낀 전 대회 완료 경기(+세트)에서 총 승패·승률·세트/점수 득실·풀세트·부전 카운트와 상대 선수별 head-to-head(`byOpponent`)를 집계, `opponentPlayers`(팀에서 나 제외·게스트팀명 폴백)·`hasCareerRecord`. Profile "대회 커리어" 탭에 통합 전적 카드(승/패/승률 게이지·세부지표)+상대 전적 카드(자주 만난 상대별 W/L 최대 8명)를 추가, 내 엔트리 id 배치로 tournament_matches 조회(try-catch degrade, 헤더 mmr delta 근사와 달리 실경기 기준 정확 전적). 파트너 매칭: `collectPastPartners`(내가 낀 복식 신청 이력에서 상대를 모아 함께 출전 횟수·최근순 집계)+`rankPartnerSuggestions`(호출부 checkEligibility 주입 → 종목 자격 통과 먼저·횟수·최근순)+`partnerReason`. TournamentDetail 복식 신청 폼에 "추천 파트너 · 지난 대회에 함께 나간 분들" 카드(자격 통과 최대 4명, "다시 초대" 원터치→selectPartner). 대진DB 개인화 추천으로 검색-only 마찰 완화. 잔여: 대회 탐색 추천(급수·지역 맞춤 대회 추천)만 남음 |

## 실행 로그 (최신 위)
- 2026-07-11 · 심판(판정 자동화) · `src/lib/bwf.js`(matchCall 신규)·`src/pages/referee/Scoreboard.jsx`
  · 자동 심판 콜 + 음성 안내(TTS) — 4개 플로우 중 최저(심판 78%)의 유일한 비-human-gated 잔여를 채움.
    지금껏 점수판은 인터벌·게임종료·골든포인트 오버레이만 있고, "지금이 게임 포인트/매치 포인트/듀스인지"를
    화면·음성으로 알려 주지 않아 비전문가 동호인 심판이 스스로 규칙을 판단해야 했다(로드맵 1-1의 "자동 심판
    콜 문구 + TTS 음성" 미구현 조각, 무심판 셀프스코어는 RLS 확장이 선행돼야 해 human-gated로 남김). 순수
    함수 `bwf.matchCall(state)` 신설 — 현재 점수·게임 승수·config만으로 골든포인트(cap-1 동점)/매치포인트
    (게임 포인트인데 이 게임을 이기면 매치 종료)/게임포인트(1점 더 내면 게임 획득, isGameOver 재사용으로
    판정)/듀스(pointsPerGame-1 이상 동점)를 자동 판정해 `{key,team,label}` 반환(진행 중 아닐 때·null 안전,
    게임종료·인터벌은 기존 flags/오버레이가 담당하므로 제외). Scoreboard 배선: (1) `liveCall`을 현재 state에서
    파생해 점수판 하단에 상황 배너(골든=노랑/매치포인트=빨강/게임포인트=파랑/듀스=회색, 정적 스타일 매핑,
    새로고침 복원에도 점수 파생이라 유지·오버레이 중엔 숨김), (2) 헤더에 스피커 토글(localStorage 'bmg_ref_voice',
    기본 OFF·aria-pressed) — 켜면 매 득점마다 `announce(next)`가 SpeechSynthesis(브라우저 내장·키/서버 불필요,
    미지원 시 조용히 무시, 직전 콜 cancel)로 서버 팀 점수를 먼저 부르는 BWF 관례대로 "N 대 M" + 매치/게임
    포인트·듀스, 게임 종료("N게임 종료 … 승리")·인터벌·경기 종료·기권까지 한국어로 읽어 준다. 순수 엔진
    12개 시나리오(게임/매치 포인트·듀스·골든·cap 근처·팀2·미들게임 무콜·finished/null 안전·applyPoint 실플레이)
    node 자체 검증 통과, `npx vite build` green. 비파괴적 추가만(기존 득점·언두·오버레이·확정 로직 불변).
    (자동화율 심판 78%→82%)
- 2026-07-11 · C12 · `src/lib/discover.js`(신규)·`src/lib/grades.js`(checkEligibility 승격)·`src/pages/player/Tournaments.jsx`·`src/pages/player/TournamentDetail.jsx`
  · 대회 탐색 추천(C12 ⚠️→✅) — C12의 마지막 비-human-gated 조각 "급수·지역 맞춤 대회 추천"을 채워
    C12를 ✅로 마감. 지금껏 "대회 찾기"는 상태 필터 + 대회명/장소 텍스트 검색만 있어, 선수가 "내가 참가할 수
    있는·자주 가던 지역의·마감 임박한" 대회를 직접 눈으로 훑어야 했다(C12 백로그의 "대회 탐색 추천" 미구현).
    대진DB(내 참가 이력)와 내 급수를 종합한 개인화 추천을 얹는다. 먼저 신청 화면(TournamentDetail)에만 있던
    `checkEligibility`(급수 3축 화이트리스트/레거시 범위 + 종목별 MMR 게이트)를 `lib/grades.js`로 승격(전
    의존 헬퍼가 이미 grades에 있어 자연스러운 이동, TournamentDetail은 import로 교체·동작 불변)해 탐색 추천이
    신청과 100% 동일한 자격 로직을 재사용하게 했다(중복 0). 순수 엔진 `discover.js` 신설(스키마·외부 키·LLM
    불필요) — `regionTokens`(venue·주소에서 17개 시·도 + 시/군/구 세밀 단위를 관대 추출, 광역시/특별시/자치시·도
    접미어는 시도 토큰과 중복이라 세밀에서 제외), `preferredRegions`(내가 참가한 대회들의 지역을 빈도순 집계),
    `ddayOf`(로컬 자정 기준 D-day, 타임존 밀림 방지), `recommendTournaments`(접수중·미신청·미래 대회 중
    fitOf가 급수로 참가 가능한 종목이 있다고(eligibleCount>0) 판정한 것만 후보로 삼아, 지역 매칭(+40)·접수
    마감 임박(D-7 이내 가산·D-2 이하 urgent)·대회일 근접으로 점수화하고 근거 배열을 붙여 상위 N개 반환).
    Tournaments.jsx 배선: 로그인 선수면 프로필(select '*')·참가 이력(tournament_entries→category→tournament
    venue)을 1회 로드(try-catch degrade)→preferredRegions로 자주 가던 지역 집계·appliedIds로 이미 신청한
    대회 제외, useMemo로 recommendTournaments(fitOf가 각 대회 categories에 checkEligibility 적용) 계산,
    전체 탭·검색 없을 때만 목록 상단에 "🎯 나에게 맞는 대회" 섹션(기존 TournamentCard 재사용 + 근거 칩:
    급수 파랑/지역 초록/마감 임박 빨강·주황). 비파괴적 추가(기존 필터·검색·목록 UI 불변, 미로그인·실패 시
    추천 없이 그대로). 엔진 31개 시나리오(지역 토큰 추출·특별시 중복 제외·null 안전·지역 빈도·D-day·미자격/
    미신청/비접수/과거 제외·지역 매칭 우선순위·마감 urgent·오늘·limit·근거 순서) esbuild(node) 자체 검증
    통과, `npx vite build` green. C12 완결 — 남은 ⚠️(C1·C3·C5·C9·C11)의 잔여는 전부 human-gated(외부 발송·
    PG·실LLM·클럽 필드·계좌 필드)만. (자동화율 선수 86%→88%)
- 2026-07-11 · C12 · `src/lib/record.js`(신규)·`src/pages/player/Profile.jsx`
  · 통합 전적 뷰 — C12의 남은 비-human-gated 조각 "통합 전적(전 대회 W/L·상대전적)"을 채움. 선수 플로우
    (84%, 4개 플로우 중 최저 중 하나)의 커리어 화면이 지금껏 대회 "목록·신청 상태"만 나열하고, 헤더의 승/패는
    mmr_history delta(승=delta>0)를 세는 근사치라, "내가 실제로 몇 경기 이겨왔나·저 사람한테 몇 승 몇 패인가"
    같은 실제 전적을 볼 수 없었다(C12 백로그의 "통합 전적" 미구현 조각). 순수 엔진 `record.js` 신설(스키마·외부
    키·LLM 불필요) — `opponentPlayers(entry, myPlayerId)`(팀 엔트리에서 나를 빼고 상대 선수 [{id,name}] 추출,
    복식 2명·단식 1명, 선수 프로필 없으면 team_name 기반 단일 상대 폴백, 중복/누락 방어), `computeCareerRecord
    ({matches, myEntryIds, myPlayerId})`(내가 낀(myEntryIds에 든) 완료/부전/bye 경기를 훑어 총 wins/losses·
    walkoverWins/Losses·setsWon/Lost·pointsFor/Against·fullSets·played를 집계하고, 완료·부전 경기마다 상대
    선수별 head-to-head를 `byOpponent` Map에 누적(bye는 상대 없어 제외, forfeited는 실제 상대 있어 포함), 대회
    수(tournaments)·승률(winRate)까지 반환, 내가 안 낀 경기·승자 미정·null 안전), `hasCareerRecord`(집계된
    승패가 있어야 카드 노출). Profile 배선: load()에서 내 엔트리 id 전량(created_at desc·최대 300, URL 길이
    방어)을 가볍게 조회→`tournament_matches`를 `team1/2_entry_id.in.(...)`로 배치 조회(카테고리·대회·양팀 선수
    프로필·match_scores join)→computeCareerRecord로 `record` 상태 저장(테이블/RLS 실패는 try-catch로 조용히
    degrade해 프로필 자체는 정상 표시). "대회 커리어" 탭 상단에 (1) "통합 전적" 카드(전 N개 대회·실경기 기준,
    승/패/승률 3칸+승률 게이지+세트/점수 득실·풀세트 접전 세부지표+부전 포함 표기), (2) "상대 전적" 카드(자주
    만난 상대별 이름·경기수·N승 N패, 우세 초록/열세 빨강, 최대 8명+외 N명)를 추가하고 기존 참가 대회 목록은
    "참가한 대회" 소제목 아래로 유지(비파괴적 추가만, 헤더 mmr 근사 승/패·기존 목록 그대로). SELECT는 이미
    공개(LiveScore/Results가 matches를 읽음)라 새 권한 불필요. 엔진 20개 시나리오(승패·부전승/패·bye 상대제외·
    forfeited 상대포함·세트/점수 득실·풀세트·승률·대회수·head-to-head 정렬·내가 안 낀 경기 제외·미완료 제외·
    null/무인자 안전) 자체 검증 통과, `npx vite build` green. 잔여: 대회 탐색 추천(급수·지역 맞춤)만 C12 다음
    슬라이스로 남김. (자동화율 선수 84%→86%)
- 2026-07-11 · C12 · `src/lib/partners.js`(신규)·`src/pages/player/TournamentDetail.jsx`
  · 파트너 추천(과거 함께 출전한 파트너 재초대) — 마지막 남은 비-human-gated ⚠️ 클러스터 C12를 착수. 복식 종목
    신청은 파트너가 필수인데 지금껏 "전화번호·이름으로 검색"만 있어, 예전에 같이 나간 파트너의 번호를 기억
    못 하면 신청이 막히는 마찰이 있었다(선수 완주의 신청 단계 friction, C12 "추천/매칭 없음"). 대진DB에서
    개인화한 추천을 얹어 원터치 재초대를 제공한다. 순수 엔진 `partners.js` 신설(스키마·외부 키·LLM 불필요,
    자격 검사는 호출부 checkEligibility 주입으로 재사용·중복 0) — `PARTNER_COLS`(자격+표시+삽입용 컬럼,
    searchPartner의 cols와 동일 집합을 모듈 상수로 승격해 두 곳 재사용), `collectPastPartners(entries, myId)`
    (내가 player1/2로 낀 복식(player2_id 있음) 신청 이력에서 상대 id를 모아 함께 출전 횟수·최근 created_at
    집계, 단식·내가 안 낀 행·자기자신 방어, 횟수 내림차순·최근순 정렬), `rankPartnerSuggestions(candidates,
    isEligible)`(각 후보 profile에 주입된 isEligible 적용 → {eligible, reason} 부여, 자격 통과 먼저·횟수·
    최근순), `partnerReason(count)`(3+=단골/2/1 사유 문구). TournamentDetail 배선: (1) load()에서 로그인
    시 내 복식 신청 이력을 tournament_entries에서 조회(`.not('player2_id','is',null).or(player1/2.eq.me)`,
    RLS·테이블 실패 시 try-catch로 추천 없이 검색만 degrade)→collectPastPartners→상위 20명 프로필을
    PARTNER_COLS로 배치 조회→`pastPartners` 상태에 {profile,count,lastAt} 저장, (2) 복식 카테고리 신청 폼에서
    per-cat `partnerSuggestions`=rankPartnerSuggestions(pastPartners, checkEligibility(_,cat,t))의 자격 통과
    최대 4명 계산, (3) 파트너 미선택·미검색 상태의 검색 프래그먼트 상단에 "추천 파트너 · 지난 대회에 함께 나간
    분들" 카드(이름·급수칩·인증배지·"함께 N번 출전한 단골 파트너" 사유·"다시 초대" 버튼→기존 selectPartner
    재사용, 제출 시 기존 파트너 자격 재검증 그대로). 비파괴적 추가(기존 검색·선택·자격 로직 불변). 엔진
    18개 시나리오(집계·횟수/최근 정렬·null 안전·자격 필터·정렬·사유) 자체 검증 통과, `npx vite build` green.
    (자동화율 선수 82%→84%)
- 2026-07-11 · C3 · `src/lib/deposit.js`(신규)·`src/pages/player/MyMatches.jsx`
  · 선수 입금 안내 — 참가비 결제 단계의 선수측 완주 공백을 메움. 지금껏 참가비 있는 대회에 신청한 선수는
    MyMatches에 "입금 대기" 배지만 봤을 뿐, **얼마를·어떤 계좌에·어떤 입금자명으로** 넣어야 하는지 화면에
    전혀 없어 결제 단계가 앱 밖 단톡방·눈치에 묶여 있었다(접수→입금→승인 무인 체인의 선수측 구멍). 특히
    주최자의 C3 무통장 자동매칭(`payment.js matchDeposits`)은 입금자명을 신청 팀 player1/player2 실명과
    유사도 대조하는데, 선수에게 "실명으로 입금하라"는 안내가 어디에도 없어 애칭·타인 명의 입금이 자동확인을
    빗나가게 했다 — 자동화 전제가 선수에게 전달되지 않던 것. 순수 엔진 `deposit.js` 신설(스키마·외부 키
    불필요) — `formatWon`(₩ 천단위·음수), `shouldShowDeposit(entry, fee)`(참가비>0이고 파트너 수락대기/
    거절·반려·철회·취소가 아닌 신청만 입금 단계로 판정), `depositGuide(entry, {fee, myName, partnerName})`
    (무료=미해당, confirmed=입금 완료·자동 확인됨, refunded=환불, pending=금액·"본인 실명 입금자명"·3단계
    안내·파트너 있으면 "본인 또는 파트너 실명 중 하나로" 노트/없으면 "계좌는 문의/공지 확인" 노트, matcher가
    둘 다 허용하므로 각 뷰어에게 자기 실명을 안내). MyMatches 배선: entries select에 category.entry_fee 추가,
    신청 카드마다 dep 계산(myName=본인 인증실명 우선), 미입금 pending이면 "💳 입금 안내" 카드(금액 큰 글씨·
    입금자명 원터치 복사 버튼 copiedName 피드백·번호 단계·노트), confirmed면 초록 "입금 완료·자동 확인됨" 한 줄.
    비파괴적(추가만, 기존 배지/파트너 메시지 유지). 계좌번호 직접 표시는 tournaments에 계좌 필드가 없어
    (마이그레이션 human-gated) 이번 범위 제외 — 안내는 문의(C9 챗봇)/주최자 공지로 유도. 엔진 28개 시나리오
    (포맷·show 판정 7종·무료/null·pending/confirmed/refunded·payerName·파트너 노트·payment_amount override)
    자체 검증 통과, `npx vite build` green. (자동화율 선수 80%→82%)
- 2026-07-11 · C7 · `src/lib/advance.js`(planTeamForfeit·forfeitTeamRemaining 신규)·`src/pages/organizer/LiveDashboard.jsx`
  · 팀 대회 이탈·실격 일괄 부전 처리(C7 ⚠️→✅) — 운영 무인 완주를 막던 마지막 반복 수작업을 제거.
    지금껏 한 팀이 실격당하거나 부상·개인 사정으로 대회 중 빠지면, 그 팀의 남은 경기를 주최자가
    하나씩 손으로 부전 처리해야 했고(조별리그면 남은 상대 경기가 여러 개), finalizeRanks는 미완료
    경기가 하나라도 있으면 throw하므로 그 반복 처리를 끝낼 때까지 시상 확정이 막혔다(북극성 DoD
    "실격 시 출전권 무효" 미충족). 순수 함수 `planTeamForfeit(matches, entryId)` 신설 — 그 팀이 낀
    미완료(≠completed/forfeited/bye) 경기를 훑어 상대가 정해진 것은 `toForfeit`(상대=승자·팀번호),
    상대 미정(녹아웃 TBD 슬롯=null)은 `toVacate`(슬롯번호)로 분류(null 안전). 녹아웃은 진출로
    슬롯이 점진 채워져 보통 현재 경기 1건, 조별은 사전 편성돼 남은 상대 경기 여러 건이 잡힌다.
    실행 `forfeitTeamRemaining(supabase, categoryId, entryId, {reason})` — toForfeit는 각각
    completeMatch(resultType='walkover', forfeitTeam, forfeitReason)로 처리(미실시 경기라 MMR·득실
    미반영은 apply_match_mmr RPC가 walkover 제외로 판정, 상대는 advanceWinner로 자동 진출·조별이면
    checkPoolStageComplete까지 재사용), toVacate는 그 팀 슬롯을 null로 비워 이후 진출에서 제외,
    {forfeited, vacated, errors} 반환. LiveDashboard 배선: `activeTeams` useMemo(catMatches에서 미완료
    경기가 남은 팀·남은 경기 수 집계)+진행 중 대회에서만 노출되는 "팀 대회 이탈·실격 처리" 접이식
    패널(팀별 남은 경기 수+"대회에서 제외" 버튼), `handleTeamForfeit`가 confirm+사유 prompt(기본 "실격")
    후 forfeitTeamRemaining 호출→자동 조치 로그 기록, 상대 미정 slot이 있으면 확인 안내. 스키마·외부
    키 불필요(기존 completeMatch/advanceWinner 재사용, 로직 중복 0). entry_status는 건드리지 않아
    정산(withdrawn/rejected 제외 규칙)에 영향 없음. 엔진 11개 시나리오(조별 다건 부전·팀번호·상대
    승자·녹아웃 현재+TBD vacate·완료건/무관팀 제외·null 안전) 자체 검증 통과, `npx vite build` green.
    (자동화율 운영 85%→87%)
- 2026-07-11 · C11 · `src/lib/highlight.js`(신규)·`src/pages/player/Results.jsx`
  · 개인 대회 하이라이트 요약 — 선수 플로우(78%, 공동 최저)의 마지막 감정적 종점을 채움. 북극성
    DoD "선수: …결과·급수·상장까지 화면 하나로 완결"에서 상장까지는 있었지만 "내 대회가 어땠나"를
    돌아볼 회고가 없어, 대회가 끝나면 선수 경험이 순위표에서 끊겼다(C11 하이라이트 요약이 미구현으로
    남아 있던 조각). 순수 엔진 `highlight.js` 신설(스키마·외부 키·LLM 불필요, 규칙 기반) —
    `computePlayerStats(matches, entryId, entryById)`가 내 팀이 낀 완료/부전 경기를 훑어 played(실경기)·
    wins/losses(부전승/부전패 분리 카운트)·setsWon/Lost·pointsFor/Against·fullSetCount(풀세트 접전)·
    closest(3점차 이내 명장면)·bestWin(최다 점수차 완승)을 집계, `winRate`, `buildPlayerHighlight`가
    거기에 순위(certRankInfo 재사용)·MMR 총변동을 얹어 순위/전적 기반 헤드라인·본문 줄(있는 정보만)·
    격려 다음목표·메달·색을 담은 카드 데이터를 만들고(집계할 내용 전무 시 null), `highlightShareText`가
    공유·복사용 한 줄 요약을 만든다. Results 배선: 대회 종료(completed)+내 참가 시 "내 대회 하이라이트"
    카드(메달·헤드라인·본문·전적/승률/세트/MMR 스탯 칩·"🎯 다음 목표"·"하이라이트 공유하기"
    navigator.share→클립보드 폴백). MMR 총변동은 load()에서 mmr_history(player_id·tournament_id)
    delta 합산으로 조회(테이블 미적용/실패 시 try-catch로 MMR 줄만 조용히 생략). 엔진 31개 시나리오
    (승패·세트·부전승/패·미참여·null 안전·우승/무순위/전승 헤드라인·명장면 vs 완승 분기·공유 텍스트)
    자체 검증 통과, `npx vite build` green. 실외부발송(문자/알림톡)만 human-gated 유지.
    (자동화율 선수 78%→80%)
- 2026-07-11 · C7 · `src/lib/checkin.js`(assessNoShowResolution 신규)·`src/pages/organizer/LiveDashboard.jsx`
  · 노쇼 자동 부전승 확정 — 운영 완주를 막던 마지막 사람 1탭(overdue 경기의 "누가 안 왔는지"
    확인)을, 이미 앱이 가진 셀프 체크인(C4) 데이터로 확신할 수 있는 경우 무인화. 지금껏 노쇼
    타이머는 감지·경고·카운트다운까지만 자동이고, "어느 팀이 안 왔는지"는 현장 판단이라 매 노쇼마다
    사람이 부전승 버튼을 눌러야 해 무인 진행이 그 지점에서 멈췄다. 하지만 체크인은 "누가 대회장에
    왔는지"를 이미 안다 — 한 팀 전원 체크인(현장에 있음)이고 상대 팀 전원 미체크인(오지 않음)이면
    누가 부전승인지 확신할 수 있다. 순수 함수 `assessNoShowResolution(match, checkedInSet)` 신설
    (checkin.js) — 팀별 체크인 현황(present=전원 체크인/absent=전원 미체크인/partial)을 계산해,
    (t1.absent && t2.present) 또는 (t2.absent && t1.present)일 때만 `resolvable=true`+absentTeam
    +winnerTeam+reason 반환, 애매한 경우(둘 다 present=코트만 안 옴 / 둘 다 absent=더블 노쇼 /
    부분 체크인)는 resolvable=false로 사람에게 남긴다(near-zero touch, 예외만 사람). LiveDashboard
    배선: 체크인한 선수 id 집합 `checkinSet`을 뷰와 무관하게 상시 로드(loadCheckinSet)+
    tournament_checkins 실시간 구독(선수가 폰으로 체크인하면 즉시 반영, 테이블 미존재 시 빈 Set
    degrade), 노쇼 useEffect의 overdue 경기에 대해 무인 진행 ON이면 `assessNoShowResolution`이
    resolvable인 것만 `walkoverNoShow`(수동 resolveNoShow와 공유하는 코어)로 자동 확정
    (autoResolvedRef 중복차단·먼저 마킹, 실패 시 ref 삭제로 재시도 허용, calledIds/warnedRef는
    completeMatch가 대진 진출까지 처리). 다시 호출(handleCall) 시 autoResolvedRef도 초기화.
    "노쇼 확인 대기" 패널엔 각 경기의 체크인 힌트 배지(팀별 체크인 완료/미체크인/부분, 초록/빨강/
    회색)와 resolvable이면 "추천: N팀 노쇼 부전승 처리" 원터치 버튼을 추가해 무인 OFF·애매한
    경우에도 사람 판단을 돕는다. 스키마·외부 키 불필요(기존 tournament_checkins·completeMatch 재사용).
    엔진 12개 시나리오(팀1/팀2 미체크인·둘다 체크인/미체크인·부분 체크인·단식·배열입력·null 안전)
    자체 검증 통과, `npx vite build` green. (자동화율 운영 82%→85%)
- 2026-07-11 · C1 · `src/lib/orchestrator.js`(planNoShow 확장)·`src/pages/organizer/LiveDashboard.jsx`
  · 호출 재알림 타이머 — 진단이 "가장 큰 공백"으로 지목한 C1의 남은 조각(재알림)을 채움. 지금껏
    호출(callMatch)은 인앱 실시간 방송이라 그 순간 앱을 안 보던 선수는 놓쳤고, 다음 접점은 2분 뒤
    "곧 부전승" 경고(warned)뿐이라 그 사이 놓친 선수를 다시 부를 부드러운 재호출이 없었다(북극성
    "선수: 호출까지 화면 하나로 완결"의 신뢰도 갭). 순수 함수 `planNoShow`에 재알림 판정을 추가 —
    호출된 채 아직 시작 안 한 waiting 구간 경기를 `recallAfterSec(45s)` 무응답이면 `toRecall`로 분류하고,
    이후 `recallEverySec(45s)` 간격으로 `recallMaxCount(2회)`까지만 반복(스팸 방지). `recalledAt`
    ({at,count}) 맵으로 중복·간격을 판정하고, status에 `recallCount`를 실어 UI 표시. warned/overdue로
    넘어가면 재알림은 멈추고 기존 경고·부전승 경로가 이어받는다. LiveDashboard: `recalledRef` 신설,
    노쇼 useEffect에서 무인 진행 ON이면 `toRecall` 경기를 `callMatch`로 자동 재방송(recalledRef 먼저
    갱신해 중복 차단, **calledIds 원 호출시각은 건드리지 않아 부전승 카운트다운은 그대로 흐름**),
    자동 조치 로그에 "N번 코트 재호출 — 팀 (응답 없음)" 기록. 새 호출(handleCall·자동 toCall)이면
    recalledRef도 초기화해 시퀀스 재시작. 예정 카드 카운트다운에 "· 재호출 N회" 표시. 선수 MyMatches는
    기존 match_call 수신 로직이 재방송을 그대로 배너·진동으로 재현(코드 변경 불필요). 스키마·외부 키
    불필요. 엔진 11개 시나리오(초기 무재알림·45s 첫 재알림·간격 미달·2차 재알림·max 초과·warned/overdue
    우선·미호출/시작경기 제외) 자체 검증 통과, `npx vite build` green. (자동화율 선수 76%→78%, 운영 80%→82%)
- 2026-07-10 · C8 · `src/lib/planWizard.js`(신규)·`src/pages/organizer/CreateTournament.jsx`
  · 요강·설정 마법사(C8 ⚠️→✅) — "설정 폼만, 역산/문서생성 없음"이던 클러스터를 채움. 북극성은
    주최자가 "개설"만 하면 되게 하는 것인데, 지금껏 개설 화면은 조 크기·포맷·상금까지 전부 주최자가
    감으로 정하고 "몇 시에 끝날지"는 계산해 주는 게 없어, 개설 단계가 사람 판단에 통째로 묶여 있었다.
    순수 엔진 `planWizard.js` 신설(외부 키·스키마 불필요, 기존 대진 규칙 재사용) — `distributePools`
    (팀을 최대한 고른 조로 분배), `estimateMatches`(포맷별 실경기 수 역산: 리그=nC2, 토너먼트=n-1(+3·4위전),
    조별+토너=조별합+진출자-1), `defaultMatchMinutes`(점수제·판수로 경기당 시간 추정), `estimateSchedule`
    (조별은 코트 병렬·녹아웃은 라운드 순차로 소요 시간·예상 종료 시각 계산), `estimateTournament`
    (전 종목 합산), `recommendSetup`(≤5팀 리그전 / ≤8팀 4팀조 / 9팀+ 가장 고르게 나뉘는 조 크기 자동
    선택+초보용 이유 문구), `buildGuidelines`/`guidelinesHtml`/`printGuidelines`(대회 개요·일정·종목·경기
    방식(BWF)·시상·유의사항 6섹션 요강을 인쇄=PDF로 자동 생성, XSS 이스케이프). CreateTournament 배선:
    (1) 각 종목 "대진 방식 설정" 펼침 맨 위에 "AI 대회 설계 도우미" 카드 — 정원 기준 추천이 현재 설정과
    다르면 헤드라인·이유·"이 추천 적용"(포맷·조크기·진출 수 일괄 반영), 항상 예상 경기 수·소요·코트 수 기준
    예상 종료 시각 표시, (2) 하단 "예상 진행·요강" 섹션 — 전 종목 합산 예상 경기/소요/종료 + "요강 문서
    만들기(PDF)" 버튼(대회명·날짜 있으면 활성). 엔진 30개 시나리오(조 분배·포맷별 경기 수·코트 병렬 소요·
    추천 분기·시간 포맷·요강/XSS) 자체 검증 통과, `npx vite build` green. (자동화율 주최자 87%→89%)
- 2026-07-10 · 심판 도달경로 · `src/pages/referee/CourtReferee.jsx`(신규)·`src/App.jsx`·`src/pages/organizer/TournamentManage.jsx`·`src/pages/organizer/LiveDashboard.jsx`
  · 코트별 심판 모드 — 심판 플로우 최저(70%)의 유일한 코드 갭이던 "심판 점수판 도달 경로 부재"
    (audit L1)를 메움. 지금껏 코트에 배치된 심판은 자기 코트의 점수판을 스스로 찾을 화면이 없어,
    주최자가 LiveDashboard에서 새 탭을 열어주거나 `/referee/:matchId` URL을 손으로 공유해야만
    했다(DoD "심판: 코트배정 자동배포"의 미충족 고리). 신규 페이지 `CourtReferee.jsx`
    (`/referee/court/:tournamentId[/:courtNo]`) — (1) 코트 선택 그리드(각 코트 경기중/대기/비어있음
    +현재 대진 미리보기), (2) 선택 코트 패널: 현재 경기(진행 중이면 라이브 스코어+"점수판 이어서 열기",
    예정이면 "이 경기 점수 입력 시작") 원터치로 기존 BWF 점수판 진입 + 이 코트 대기열, (3)
    tournament_matches 실시간 구독으로 경기가 끝나 다음 경기가 그 코트에 자동 배정되면(advance.js
    승자 진출·scheduler 코트 배정) 화면이 스스로 갱신(코트배정 자동배포) + 15초 폴링 폴백 +
    ConnectionStatus. 스키마·외부 키 불필요 — 읽기 전용 도달 경로만 채우고 실제 점수 저장·승자 진출은
    기존 Scoreboard.jsx가 담당(로직 중복 0). 라우트 2개 등록(court 경로가 `/referee/:matchId`보다
    구체적이라 우선), 진입점 2곳: TournamentManage 메뉴 "코트별 심판 모드" + LiveDashboard 경기진행
    탭 상단 퀵링크(코트 staff에게 per-court URL 배포 가능). `npx vite build` green. 잔여: 무심판 셀프
    스코어(선수 자가 점수 입력)는 tournament_matches UPDATE RLS 확장이 선행돼야 해 human-gated.
    (자동화율 심판 70%→78%)
- 2026-07-10 · C5 · `src/lib/drawOptimizer.js`(신규)·`src/pages/organizer/BracketGenerator.jsx`
  · AI 대진 최적화 — 조별 실력 균형 + 설명(AI 차별화 레이어). 지금껏 조 편성은 무작위 씨드 1개를
    뽑아 그대로 확정이라, 운이 나쁘면 한 조에 강팀이 몰리고 옆 조는 약팀만 모여 대진이 기울었고
    주최자·선수 누구도 "왜 이렇게 됐냐"를 알 수 없었다(엔진 generatePools는 있지만 그 위에 AI 판단
    레이어가 없던 상태). 순수 엔진 `drawOptimizer.js` 신설 — `poolMeanMmr`(조 평균 MMR·MMR 있는 팀만),
    `scoreDraw`(조별 평균 MMR 스프레드=가장 센 조−약한 조 + 조크기 편차 페널티, 낮을수록 균형),
    `candidateSeeds`(baseSeed 파생 결정적 후보·재현성 유지), `optimizeDraw`(시드 켜짐이면 스네이크
    결정적이라 후보 1개=seeded / 꺼짐이면 후보 16개를 generatePools로 시뮬레이션해 score 최소 대진
    선택=balanced, best/worst/avg 스프레드 반환), `explainDraw`(seeded/balanced/no-mmr별 초보용 한국어
    설명·조별 평균 배지). BracketGenerator: "AI 균형 추첨" 토글(기본 ON, 조별 포맷·2개 이상 조·MMR
    있음·무작위 편성일 때만 노출 — 시드 켜짐이면 이미 균형이라 숨김), startDraw가 useOptimizer면
    optimizeDraw로 최적 씨드·조 선택(고른 씨드를 plan.seed로 저장→공개추첨 재현성 유지), 완료 화면에
    "왜 이 대진이 균형적인지" 설명 카드(헤드라인·상세·조별 평균 칩·무작위 대비 개선폭)+조 헤더에 평균
    MMR 배지(추첨 완료 후에만 노출로 추첨 서스펜스 유지). 클럽 필드가 스키마에 없어 클럽분리는 제외
    (human-gated), 코트이동최소는 C6 planRebalance가 담당. 스키마·외부 키 불필요(기존 generatePools
    재사용). 엔진 22개 시나리오(평균·점수·크기페널티·후보씨드·seeded/balanced·재현성·단일조·부분MMR·
    설명 3분기) 자체 검증 통과, `npx vite build` green. (자동화율 주최자 85%→87%)
- 2026-07-10 · C2 · `src/lib/stateMachine.js`(planAutoFinalize 추가)·`src/pages/organizer/LiveDashboard.jsx`
  · 무인 시상 확정(C2) — 주최자 완주의 마지막 사람 손길 제거. 지금까지 planTournamentState 는
    in_progress→completed 만 auto:false(무인 안 함)로 두고 "실시간 진행 화면에서 한 번 확인"만
    추천해, 전 경기가 끝나도 사람이 "대회 종료·시상 확정" 버튼을 눌러야 순위·급수·상장이 확정됐다
    (주최자 유일 잔여 수작업). MMR 은 이미 경기 완료 때(completeMatch) 반영되므로 확정이 추가하는 건
    최종순위(final_rank)·급수 승급뿐 — 그래도 점수 오류·이의제기를 흡수할 3분 유예 창을 두고 자동화.
    순수 함수 `planAutoFinalize({matches,allDoneSince,now,graceSec=180})` 신설 — 부전승/부전 제외
    실경기가 전부 끝났는가(allDone)·유예가 지나 지금 확정해도 되는가(ready)·남은 유예초(remainingSec)
    를 판정. 실제 finalizeTournament 호출·유예 시작시각(allDoneSinceRef) 관리는 호출부(LiveDashboard).
    LiveDashboard 는 matches 가 활성 종목만 담기므로 값싼 게이트(활성 종목 완료) 후 전 종목 status 를
    재조회해 판정하고, 무인 진행 ON + ready 면 finalizeTournament 를 1회 자동 실행(autoFinalizingRef
    중복 차단, 실패 시 재시도 허용)→status='completed'·순위표 이동·급수 승급 배너. 유예 카운트다운은
    "무인 시상 확정 대기 — 약 m:ss 후 자동 확정, 점수 정정이 필요하면 지금 하세요" 배너로 표시하고
    "지금 시상 확정" 원터치 제공(무인 OFF면 기존 수동 버튼 그대로). 실시간 틱 hasLive 게이트에
    유예 진행 조건을 추가해 카운트다운이 확정까지 이어지게 함. 수동 finishTournament 도 승급 결과를
    캡처해 배너 표시(기존엔 반환값 무시로 승급 배너가 실제로 안 떴음 — 부수 수정). 스키마 변경·외부 키
    불필요(기존 finalizeTournament·apply_match_mmr·promote_grades RPC 재사용). 엔진 8개 시나리오
    (빈·onlyBye·mixed·유예 시작/중간/경과·grace0) 자체 검증 통과, `npx vite build` green.
    (자동화율 주최자 80%→85%)
- 2026-07-10 · C6 · `src/lib/orchestrator.js`(planRebalance 추가)·`src/pages/organizer/LiveDashboard.jsx`
  · 빈 코트 실제 재배치 실행(C6 ⚠️→✅) — 운영 완주를 막던 마지막 실행 갭. planAutoAdvance는
    코트마다 자기 큐만 진행해, 한 코트에 경기가 몰려 밀리는데 옆 코트가 텅 비어도 대기 경기가
    넘어가지 못했다(analyzeDelay는 그 상황을 '제안'만 하고 실행은 안 했음). 순수 함수
    `planRebalance(matches,{courtCount,busyCourts,maxMoves})` 신설 — 유휴 코트(진행 중·대기 경기
    없음+다른 종목 미사용)와 과부하 코트(진행 중+대기≥1 또는 대기≥2)를 판정해, 과부하 코트의
    대기 경기(진행 중이면 큐 맨 앞, 아니면 두 번째부터)를 유휴 코트로 옮길 {match,fromCourt,toCourt}
    계획을 만든다. 옮길 경기의 팀이 지금 경기 중이면(중복 출전) 건너뛴다. LiveDashboard가
    court_number를 실제 UPDATE(경합 방지 status='scheduled' 조건부)하면 그 경기는 유휴 코트 맨 앞이
    돼 기존 planAutoAdvance가 자동 호출→무인 완결(별도 트리거 불필요). 무인 자동 진행 ON이면
    runOrchestrator가 매 실시간 틱마다 자동 재배치(rebalancing ref 중복 차단), OFF면 "빈 코트 재배치
    추천 N건" 패널에서 fromCourt→toCourt 미리보기+원터치 실행. 다종목 공유 코트는 실행 시 cross-cat
    in_progress 조회로 정확히 제외. court_number만 바꾸므로 scheduler/advance 로직과 겹치지 않음.
    스키마 변경 없음. 엔진 9개 시나리오(유휴 감지·이동·중복출전 건너뜀·busy 제외·대기만·maxMoves·
    빈배열) 자체 검증 통과, `npx vite build` green. (자동화율 운영 74%→80%)
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
- [ ] (C3 선택·선수 입금 안내 보강) 주최자 계좌번호 직접 표시 — 현재 "입금 안내" 카드는 금액·본인 실명 입금자명·단계까지 보여주고 계좌 자체는 문의/공지로 유도한다. 계좌까지 화면에 박으려면 `tournaments`에 계좌 컬럼(`bank_name`·`account_number`·`account_holder`)을 더하는 마이그레이션을 만들어 적용하고, CreateTournament에 입력 UI를 추가(컬럼 미존재 시 조회 400 에러 방지 위해 feature-detect 후 조건부 select/insert)한 뒤 MyMatches 카드가 그 값을 표시하면 된다. 계좌는 주최자 개인정보라 스키마 결정이 필요해 human-gated로 남김.
- [ ] (다음 목표·심판 78%) 무심판 코트 셀프 스코어 — 코트별 심판 모드(`/referee/court/:id`)로 심판 도달 경로는 채웠다(2026-07-10). 남은 건 "심판 없이 선수가 자기 폰으로 점수 입력". 선수가 `/referee/:matchId`를 열어 점수를 쓰려면 `tournament_matches` UPDATE가 필요한데 현재 RLS는 주최자(001 "주최자 관리" FOR ALL)만 허용. 참가 선수도 자기 경기의 live_*·status를 쓰도록 하는 RLS 정책 마이그레이션이 선행돼야 실제 발화 가능(엔진/UI는 그 후 추가). 이 갭이 심판 플로우의 유일한 잔여 공백.
