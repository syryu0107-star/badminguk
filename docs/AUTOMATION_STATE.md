# 배드민국 완전자동화 진행 원장 (AUTOMATION_STATE)
> 자기실행 에이전트가 매 실행 갱신. 북극성: 사람 개입 0으로 대회 완주.
> 점수는 코드 실측 기준. 단조 증가(퇴행 시 사유 명기).

## 플로우 자동화율 (0~100%)
| 플로우 | 점수 | 완주 막는 잔여 갭 |
|--------|:---:|------------------|
| 주최자 | 93% | **주최자 제어 페이지 로드 실패 복구(하드닝)** ✅ — 주최자의 두 핵심 제어 화면 `TournamentManage`(무인 자동 진행 토글·상태 전환·대진 자동 생성·정산·캠페인)와 `EntryManagement`(무인 자동 승인·입금 매칭·노쇼 예측)의 `load()`가 최상위 try-catch 없이 여러 await(tournaments·categories·entries·matches / cats·es·podium)를 실행해, 네트워크 flap 으로 어느 하나라도 throw 하면 `setLoading(false)`에 못 닿아 무한 스피너에 갇혔다 → **주최자가 무인 진행을 켜지도·신청을 승인하지도 못해 자동화 자체가 시작 불능(완주 차단 티어1)**. 이제 두 페이지 load 본문 전체 try-catch(throw 시 loadError+setLoading(false) 탈출·alive 가드)+`retryTick`+에러 화면 "다시 시도"(재로드) 버튼. **노쇼 예측·예비명단 추천(C7 AI 레이어)** ✅ — 참가 신청 관리에서 신청자들의 과거 대회 불참(부전승) 이력을 자동 집계해, 당일 안 나올 가능성이 있는 신청을 배지로 짚고 "예비팀 N팀 확보" 오버부킹 추천을 생성(정원 초과 신청을 얼마나 대기시켜 둘지 판단 지원). 승인은 막지 않는 순수 advisory(무인 승인율 불변), 데이터/권한 없으면 조용히 미노출. **자동 대진 생성(C2/C5)** ✅ — 접수 마감·승인·입금·상태전환·시상확정 사이에 유일하게 남아 있던 수작업 "추첨(대진표 생성)"을 무인화. 무인 진행 ON이면 대회 당일 대진표가 없어 대회가 못 시작하고 막힐 때(stateMachine closed→in_progress가 "대진표 존재"를 조건으로 걸어 막던 지점) 앱이 공개 추첨과 동일한 로직(재현 가능한 씨드·AI 균형 편성)으로 대진표를 자동 생성→대회 자동 시작(이미 대진표 있는 종목은 절대 덮어쓰지 않음). OFF여도 막힘 배너에 "대진표 자동 생성" 원터치. **요강·설정 마법사(C8)** ✅ — 개설 시 정원(예상 팀 수)으로 대진 방식 자동 추천(규모→리그/조별+토너먼트·조 크기)·경기 수·예상 소요·예상 종료 시각 역산(코트 수 반영)·요강 문서(PDF) 자동 생성. 무통장 입금 자동 매칭 ✅ / 디지털 상장 ✅ / 사후 공지·리마인더·감사·설문(C11) ✅ / 정산 손익·원천징수 리포트(C10) ✅ / 시상 확정 무인(C2) ✅ / **AI 균형 추첨(C5)** ✅ — 조별 포맷 무작위 편성 시 후보 16개를 시뮬레이션해 조별 평균 MMR 편차 최소 대진 자동 선택 + "왜 균형적인지" 설명. 잔여: PG 실결제(human-gated)·draft→open 자동 개설(공개는 개설자 판단으로 남김)·클럽분리(프로필에 클럽 필드 없음) |
| 선수   | 88% | **대회 탐색 추천(C12)** ✅ — "대회 찾기" 화면 상단에 "🎯 나에게 맞는 대회" 개인화 추천(로그인 시): 내 급수로 참가 가능한 접수중 대회를 자주 가던 지역·접수 마감 임박순으로 골라, 근거 칩(참가 가능 종목 수·자주 가던 지역·마감 D-day)과 함께 노출(검색-only였던 탐색에 개인화 추가로 C12 마지막 조각 마감). **통합 전적(C12)** ✅ — 프로필 "대회 커리어" 탭에 전 대회 실제 경기 기반 통합 전적(총 승패·승률 게이지·세트/점수 득실·풀세트 접전·부전 포함)과 "상대 전적"(자주 만난 상대별 W/L, head-to-head) 자동 집계. 셀프 체크인·디지털 선수증 ✅, **파트너 추천(C12)** ✅ — 복식 신청 시 지난 대회에 함께 나간 파트너 중 이 종목 자격을 통과하는 사람을 "다시 초대" 원터치 카드로 추천(전화번호·이름 검색만 있던 신청 마찰 완화), **입금 안내(C3)** ✅ — 참가비 있는 미입금 신청에 MyMatches "입금 안내" 카드(금액·본인 실명 입금자명 복사·단계 안내)로 "얼마를 어떤 이름으로 넣어야 앱이 자동 확인하는지"를 처음으로 화면에 명시(주최자 C3 자동매칭이 player1/2 실명 대조 → 선수가 실명으로 넣게 유도해 무인 입금확인율↑), 입금 확인 자동화 ✅, 결과·급수·상장 ✅, 대회 안내·공지함 수신 ✅, **문의 챗봇(C9)** ✅ — 규정·일정·참가비·내신청 자동응답으로 단톡방 문의 대체, **호출 재알림(C1)** ✅ — 호출을 놓친 선수에게 경고 전 waiting 구간에서 45초 간격 최대 2회 자동 재호출(앱 잠깐 껐다 켠 선수도 다시 수신), **개인 하이라이트 요약(C11)** ✅ — 대회 종료 후 결과 화면에서 내 경기 회고(총 경기·승패·세트/점수 득실·명장면·MMR 변동+격려·다음 목표·공유)를 앱이 자동 생성해 선수 완주에 "회고" 종점 추가 / 잔여: 계좌번호 직접 표시(주최자 계좌 필드 스키마 부재·human-gated)·PG 카드결제 부재 |
| 심판   | 83% | **점수판 로드 실패 복구(하드닝)** ✅ — 심판의 유일 작업 화면 `Scoreboard`(/referee/:matchId) `load()`가 최상위 try-catch 없이 여러 await(경기 조인·이벤트·getUser)를 실행해, 네트워크 flap 으로 어느 하나라도 throw 하면 `setLoading(false)`에 못 닿아 무한 스피너에 갇혔다(loadError 는 "경기 없음"만 세팅·재시도 버튼 없음) → 심판이 점수를 못 넣어 경기가 완결 못 됨(완주 차단 티어1). 이제 load 본문 전체 try-catch(throw 시 네트워크 에러 문구+setLoading(false) 탈출)+`retryTick`+에러 화면에 "다시 시도"(재로드)/"돌아가기" 버튼. **코트별 심판 모드(도달 경로)** ✅ — 심판이 담당 코트를 고르면 그 코트의 현재/다음 경기가 나오고, 원터치로 BWF 점수판(/referee/:matchId) 진입, 경기 종료 시 다음 경기가 실시간 구독으로 자동 배포. BWF 자동판정 탭입력·종료 시 대진표 자동반영은 기존 ✅. **자동 심판 콜(판정 자동화)** ✅ — `bwf.matchCall`이 현재 점수에서 골든포인트/매치포인트/게임포인트/듀스를 자동 판정해 점수판에 상황 배너를 띄우고(새로고침에도 점수 파생이라 유지), 헤더 스피커 토글을 켜면 매 득점마다 SpeechSynthesis(브라우저 TTS·키 불필요)로 "서버 점수 대 리시버 점수 + 매치 포인트/듀스…", 게임/경기 종료·인터벌·기권까지 한국어로 읽어 준다(비전문가 동호인 심판이 규칙을 몰라도 정확한 콜). 잔여: 무심판 코트 셀프스코어(선수 자가 점수 입력 — tournament_matches UPDATE RLS 확장 필요·human-gated) |
| 운영   | 88% | 빈코트 자동투입·자동호출·사전알림·예상시각(관측 페이스 보정)·노쇼 타이머·**호출 재알림(무응답 자동 재호출)** ✅·지연 예측·**빈코트 실제 재배치 실행(C6)** ✅·**노쇼 자동 부전승 확정(C7)** ✅·**팀 대회 이탈·실격 일괄 부전 처리(C7)** ✅ — 실격·부상으로 빠지는 팀을 1번 고르면 남은 경기(조별 잔여+녹아웃 현재)를 모두 walkover(MMR 미반영)로 자동 확정+상대 자동 진출→미완료 경기가 남아 finalize를 막던 반복 수작업 제거. **무인 진행 실시간 복원력(하드닝)** ✅ — LiveDashboard 는 무인 오케스트레이터의 트리거가 realtime `tournament_matches` 갱신인데, 지금껏 그 구독에 (1)종목 필터가 없어 동시 진행되는 **타 대회·타 종목의 모든 점수 변경마다** 무거운 전체 재조회가 폭주했고, (2)연결이 끊겼다 돌아와도 따라잡기가 없어 **랩톱 절전·모바일 네트워크로 realtime 이 조용히 끊기면 자동 호출·진출·노쇼 타이머가 영구 정지**했다(코트 심판 화면 CourtReferee 는 이미 rtState·재연결 따라잡기·15초 폴링을 갖췄으나 정작 무인 핵심 화면엔 없었음). 이제 구독 핸들러가 payload row 의 category_id 로 현재 종목만 반영(재조회 폭주 제거)+재연결 시 loadMatches 로 따라잡기+15초 폴링 폴백(realtime 이 죽어도 오케스트레이터가 계속 도는 안전망)+useOnline 로 오프라인→온라인 복구, 무인 패널에 ConnectionStatus(실시간 연결됨/재연결 중/오프라인) 상시 표시. **체크인 채널 복원력(하드닝 ②)** ✅ — 노쇼 자동 부전승 판정의 유일 입력인 `checkinSet` 을 갱신하는 `checkinset` 구독도 matches 와 동일하게 재연결 따라잡기(checkinDropRef)+15초 폴링 폴백으로 정렬(전엔 status 핸들러·폴링 전무라 채널이 조용히 끊기면 셀프 체크인이 반영 안 돼 무인 노쇼 처리가 낡은 데이터로 정지). ConnectionStatus 는 두 채널(경기·체크인) 모두 연결돼야 "실시간 연결됨"으로 표시. 잔여: 애매한 노쇼(둘 다 체크인=코트만 안 옴 / 더블 노쇼)만 사람 1탭·rescheduleAfterForfeit(사전스케줄용, 라이브 미적용) |

## 클러스터 상태 (C1~C12)
| C | 클러스터 | 상태 | 비고(코드 근거) |
|---|----------|:---:|----------------|
| C1 | 경기 호출·알림 인프라 | ⚠️ | notify.js+orchestrator.js — 자동호출·사전알림(곧 호출)·예상 호출시각·**WO 카운트다운(planNoShow warned/overdue)**·**호출 재알림 타이머** ✅ end-to-end(LiveDashboard→MyMatches). 재알림: `planNoShow`가 waiting 구간(경고 전)에서 무응답 경기를 `toRecall`로 분류(recallAfterSec 45s·recallEverySec 45s·recallMaxCount 2), 무인 진행 ON이면 callMatch를 자동 반복(recalledRef 중복차단, calledIds 원 호출시각 불변→부전승 카운트다운 그대로). **배치 발송(하드닝)** ✅ — 코트 여러 개가 한꺼번에 비면 오케스트레이터가 여러 경기를 동시에 호출하는데, 낱개 `callMatch`/`callMatchSoon` 순차 await 는 매 호출 채널 구독(최대 2초)을 기다려 직렬로 밀렸다(N×2초 지연·채널 N회 개폐 낭비). `notify.callMatchBatch`(broadcastBatch=채널 1회 구독으로 전 페이로드 방송 + persistBatch=1회 insert, waitSubscribed 공용화·타이머 정리)로 toCall/toSoon 를 한 번에 발송해 지연 제거. **재알림·경고 배치화(하드닝)** ✅ — callMatchBatch 에 `warns`(buildWalkoverWarn 페이로드) 인자 추가, LiveDashboard 노쇼 useEffect 의 낱개 callMatch(재알림)·callWalkoverWarn(경고) 두 forEach(각 경기마다 새 채널 열고 최대 2초 구독+insert 1회)를 재알림→calls·경고→warns 로 묶은 callMatchBatch 단일 호출로 대체(여러 경기 동시 무응답 시 채널 N개→1개, insert N회→1회, refs 발송 전 선행으로 중복 차단 불변). 수동 callMatch(handleCall) 불변. 잔여: 웹푸시/알림톡/SMS 실발송만 human-gated 스텁 |
| C2 | 대회 상태 오케스트레이션 | ⚠️ | stateMachine.js 순수 판정 엔진. TournamentManage "무인 자동 진행": open→closed(마감/정원)·closed→in_progress(당일+대진표) 자동. EntryManagement "무인 자동 승인": 정상 신청 자동, 예외만 큐. **in_progress→completed 무인 확정** ✅ — `planAutoFinalize`(순수·유예 판정) + LiveDashboard 무인 진행 ON이면 전 종목 종료 후 3분 유예(점수정정 창) 지나 finalizeTournament 자동 실행(순위·급수·상장 데이터 확정)+승급 축하 배너, "지금 시상 확정" 원터치. **자동 대진 생성** ✅ — closed→in_progress를 막던 "대진표 없음"을 `autoDraw.js`(autoGenerateAllBrackets)가 자동 해소: 무인 ON이고 대회 당일 대진표가 없어 plan.blockReason이 뜨면 TournamentManage가 autoDrawnRef 1회 잠금으로 대진표를 자동 생성→reloadMatches→다음 틱에 closed→in_progress 자동 전환. 이미 대진표 있는 종목은 count 체크로 스킵(주최자 직접 추첨 보호), 승인<2팀은 not_enough 안내. 공개 추첨(BracketGenerator)과 buildDrawPlan/persistDrawPlan 단일 소스 공유(중복 0). **회귀 테스트 14개로 고정**(tests/autodraw.test.mjs — 진출 링크·부전승 선진출·exists 덮어쓰기 차단·round_robin 자동 생성 등). 잔여: draft→open(개설 공개)만 수동(개설자 의도적 판단으로 보류) |
| C3 | 입금·결제·환불 | ⚠️ | `payment.js`(주최자 자동매칭)+`deposit.js`(선수 입금 안내) — 무통장 입금 루프가 양쪽에서 완결. 주최자: 입금 내역 붙여넣기→신청자명 퍼지매칭(Levenshtein+정규화)+금액 대조→`payment_status='confirmed'` 자동, EntryManagement "입금 자동 매칭" 패널(자동확인/확인권장/미매칭, 1탭). 선수: `deposit.js`+MyMatches "입금 안내" 카드 — 참가비 있는 미입금 신청에 금액·**본인 실명 입금자명(복사 버튼)**·3단계 안내 노출로 "실명으로 입금→앱이 자동 확인"을 처음 명시(matchDeposits가 player1/2 실명 대조하므로 매칭율 직결). 입금 확인이 auto-approval 입금대기 버킷을 비워 무인 승인까지 연결. 잔여: 주최자 계좌번호 표시(tournaments에 계좌 필드 없음·마이그레이션 human-gated)·PG 실결제(토스)·가상계좌·환불규정 코드화 |
| C4 | 셀프 체크인 | ✅ | `checkin.js` 엔진 신설 — 선수 MyMatches "디지털 선수증" 카드에서 대회 당일/진행중 원터치 셀프 체크인(verified_method='self'). 실명인증 선수는 무인 완료, 미인증은 "본인확인 권장" 예외로만 노출. LiveDashboard 체크인 패널 실시간 반영(tournament_checkins 구독)+셀프/본인확인권장/신고 요약. 운영자 수동 체크인 병존. **checkinset 구독 복원력** ✅ — 노쇼 자동 부전승 데이터원인 checkinSet 구독에 재연결 따라잡기+15초 폴링 폴백(matches 와 동일 패턴, 채널 조용히 끊겨도 셀프 체크인 반영 지속). **checkins 뷰 구독 복원력** ✅ — 체크인 탭의 `checkins` 구독도 15초 폴링+재연결 따라잡기로 정렬(앱의 마지막 무폴백 구독)+종목 탭 전환 시 스테일 종목으로 목록 덮어쓰던 잠복 버그 수정(loadCheckinsRef 참조 고정). QR/PIN 키오스크·대리스코어링만 잔여 |
| C5 | AI 대진 최적화 | ⚠️ | `drawOptimizer.js` 신설 — 조별 포맷(2개 이상 조·MMR 있음) 무작위 편성 시 `optimizeDraw`가 후보 씨드 16개를 generatePools로 시뮬레이션→`scoreDraw`(조별 평균 MMR 편차 spread + 조크기 편차 페널티)로 채점→가장 고른 대진 자동 선택. `explainDraw`가 "왜 균형적인지"(가장 센/약한 조 평균·후보 대비 개선폭·조별 평균 배지) 초보용 설명 생성. BracketGenerator "AI 균형 추첨" 토글(기본 ON, 무작위 편성 시 노출)+완료 화면 설명 카드+조별 평균 MMR 배지. 고른 씨드 저장으로 공개추첨 재현성 유지. 시드 켜짐이면 스네이크가 이미 균형이라 seeded 설명만. 잔여: 클럽분리(프로필 클럽 필드 없음·human-gated)·부전승최소(pool 크기 균형은 반영, 녹아웃 시드 최적화는 미적용)·코트이동최소(C6 planRebalance가 별도 담당) |
| C6 | 실시간 진행·지연 재조정 | ✅ | 빈코트 감시→다음경기 자동투입(planAutoAdvance) ✅. `analyzeDelay` 지연 예측·재배치안 배너 ✅. **`planRebalance` 신설(빈코트 실제 재배치)** ✅ — 유휴 코트(진행중·대기 없음+타종목 미사용)로 과부하 코트(진행중+대기≥1 또는 대기≥2)의 대기 경기를 court_number UPDATE로 실제 이동. 옮긴 경기는 유휴 코트 맨 앞이 돼 planAutoAdvance가 자동 호출→무인 완결. 중복 출전(팀이 경기 중) 방지·다종목 사용 코트 제외·경합 시 status='scheduled' 조건부 UPDATE. 무인 ON이면 runOrchestrator에서 자동, OFF면 추천 패널 원터치. rescheduleAfterForfeit(사전스케줄 전용)만 라이브 미적용(설계상 별개) |
| C7 | 노쇼·기권·실격 자동처리 | ✅ | **노쇼 예측(AI 레이어·`noshowPredict.js`)** ✅ — 과거 대회 부전승(walkover) 이력을 대회 단위로 집계(`buildNoShowIndex`)해 선수별 불참률→위험(high/medium/low)을 판정(`predictNoShow`, 표본<3+불참<2는 보류)하고, 활성 종목 신청의 기대 불참 팀 수로 예비명단 크기를 역산(`recommendWaitlist`). EntryManagement 접수·승인 화면에 예비팀 추천 패널+신청 카드별 "불참 위험" 배지로 오버부킹 판단 지원(advisory·승인 무영향). 노쇼 타이머(orchestrator.planNoShow): 호출 후 미응답 경기를 waiting/warned/overdue 3단계로 판정 → 무인 진행 시 WALKOVER_WARN 자동 발송(선수 긴급 배너)+대시보드 카운트다운. **자동 부전승 확정(checkin.assessNoShowResolution)** ✅ — C4 셀프 체크인 데이터로 "누가 안 왔는지"를 확신할 수 있으면(한 팀 전원 체크인=현장에 있음 + 상대 전원 미체크인=오지 않음) 무인 진행 ON일 때 overdue 진입 시 자동 부전승 확정(completeMatch walkover→승자 자동 진출·MMR 미반영), autoResolvedRef 중복차단·실패 시 재시도. 애매한 경우(둘 다 체크인=코트만 안 옴 / 둘 다 미체크인=더블 노쇼 / 부분 체크인)만 "노쇼 확인 대기" 패널에서 체크인 힌트 배지+추천 버튼과 함께 사람 1탭. **실격·출전권 무효 자동처리(advance.planTeamForfeit/forfeitTeamRemaining)** ✅ — LiveDashboard "팀 대회 이탈·실격 처리" 패널에서 빠질 팀 1탭→그 팀이 낀 미완료 경기를 상대 정해진 것은 walkover 부전패(MMR·득실 미반영, completeMatch로 상대 자동 진출), 상대 미정(녹아웃 TBD 슬롯)은 슬롯 비우기로 분류해 일괄 처리. |
| C8 | 요강·설정 마법사 | ✅ | `planWizard.js` 신설 — 규모→포맷/조크기 역산 + 예상종료 계산 + 요강 문서. `distributePools`(고른 조 분배)·`estimateMatches`(포맷별 실경기 수 역산: RR=nC2·SE=n-1+3위전·PK=조별합+advancers-1)·`defaultMatchMinutes`(점수제·판수 기반)·`estimateSchedule`(조별 코트 병렬+녹아웃 라운드 순차로 소요·예상 종료 시각)·`estimateTournament`(전 종목 합산)·`recommendSetup`(≤5 리그/≤8 4팀조/9+ 최적 조크기 자동)·`buildGuidelines`/`guidelinesHtml`/`printGuidelines`(요강 6섹션 인쇄=PDF·XSS 이스케이프). CreateTournament: 대진 설정 펼침에 "AI 대회 설계 도우미"(추천이 현재와 다르면 헤드라인·이유·"이 추천 적용"+정원 기준 예상 경기 수·소요·종료), 하단 "예상 진행·요강" 섹션(전 종목 합산+요강 PDF). 엔진 30개 시나리오 자체 검증 통과. 스키마·외부 키 불필요 |
| C9 | 문의 챗봇 | ⚠️ | `chatbot.js`+`HelpChat.jsx` 신설 — 규정 FAQ(점수/부전승/노쇼/MMR/샌드배깅/파트너/신청/환불) + 대회 데이터 개인화(일정·장소·참가비·접수마감·내 신청상태·자격·시상) 18개 주제 규칙기반 검색 응답. TournamentDetail 우하단 "문의" 챗봇. 외부 LLM 키 없이 완결(실LLM 연동은 future·human-gated) |
| C10 | 결과·시상·정산 | ✅ | 순위집계·급수승급 자동 + `certificate.js` 디지털 상장 + `settlement.js` 신설 — 정산·손익 완성. 참가비 입금(confirmed)만 수입 집계, 주최자 입력 경비·상금을 지출로 빼 순손익 자동 계산(환불·미수금은 손익 무영향·정보만), 상금 원천징수(4종 세율 프리셋: 없음/기타 22%/기타 4.4%/사업 3.3%)로 세무서 납부분·선수 실지급분 분리, TournamentManage "정산·손익" 패널(순손익 ▲▼·수입/지출·종목별·경비 입력 localStorage·정산 리포트 인쇄=PDF). 실PG 결제 연동만 human-gated |
| C11 | 사후 커뮤니케이션 | ⚠️ | `campaign.js` 신설 — 대회 상태·날짜만 보고 발송할 안내를 판정: 전날 리마인더(open/closed+D-1)·당일 안내(closed/in_progress+D-0)·종료 후 감사·만족도 설문. notify.js `sendCampaign`(3채널 팬아웃)+`fetchNotices`(공지함)·CAMPAIGN 타입. TournamentManage "대회 안내·공지" 패널: 무인 ON이면 때가 된 캠페인 자동 1회 발송(localStorage 재발송 차단), OFF면 원터치 "지금 보내기". 선수 MyMatches "공지·안내" 공지함(미읽음 배지·탭 읽음, 라이브 방송 즉시 수신). **개인 하이라이트 요약** ✅ — `highlight.js` 신설(`computePlayerStats`·`buildPlayerHighlight`·`highlightShareText`), 대회 종료 후 Results "내 대회 하이라이트" 카드(총 경기·승패·세트/점수 득실·풀세트 접전·명장면(3점차 이내)/최다점수차 완승·MMR 총변동(mmr_history 합산·미적용 시 생략)+순위별 헤드라인·격려·다음 목표+스탯 칩+공유(navigator.share/클립보드), 규칙기반·키/스키마 불필요). 잔여: 실외부발송(문자/알림톡)만 human-gated |
| C12 | 대회 탐색·파트너·전적 | ✅ | `discover.js`+`partners.js`+`record.js` — **대회 탐색 추천** ✅ + **파트너 매칭** ✅ + **통합 전적 뷰** ✅. **대회 탐색 추천(`discover.js`)**: `regionTokens`(venue·주소에서 17시도+시/군/구 세밀 토큰 추출, 광역시/특별시 중복 제외)·`preferredRegions`(내 참가 이력 대회의 지역 빈도 집계)·`ddayOf`(로컬 자정 기준 D-day)·`recommendTournaments`(접수중·미신청·미래 대회 중 급수 참가 가능 종목이 있는 것만 골라 지역 매칭·마감 임박·대회일 근접으로 점수화, 근거 배열 반환). 자격 판정은 lib/grades.js로 승격한 공용 `checkEligibility`를 fitOf로 주입(신청 화면과 100% 동일 로직·중복 0). Tournaments.jsx가 로그인 선수의 프로필·참가 이력을 1회 로드→"🎯 나에게 맞는 대회" 카드+근거 칩(급수 파랑/지역 초록/마감 빨강·주황) 노출(전체 탭·검색 없을 때만, 실패 시 검색만 degrade). 파트너 매칭·통합 전적은 아래 유지. 통합 전적(`record.js`): `computeCareerRecord`가 내가 낀 전 대회 완료 경기(+세트)에서 총 승패·승률·세트/점수 득실·풀세트·부전 카운트와 상대 선수별 head-to-head(`byOpponent`)를 집계, `opponentPlayers`(팀에서 나 제외·게스트팀명 폴백)·`hasCareerRecord`. Profile "대회 커리어" 탭에 통합 전적 카드(승/패/승률 게이지·세부지표)+상대 전적 카드(자주 만난 상대별 W/L 최대 8명)를 추가, 내 엔트리 id 배치로 tournament_matches 조회(try-catch degrade, 헤더 mmr delta 근사와 달리 실경기 기준 정확 전적). 파트너 매칭: `collectPastPartners`(내가 낀 복식 신청 이력에서 상대를 모아 함께 출전 횟수·최근순 집계)+`rankPartnerSuggestions`(호출부 checkEligibility 주입 → 종목 자격 통과 먼저·횟수·최근순)+`partnerReason`. TournamentDetail 복식 신청 폼에 "추천 파트너 · 지난 대회에 함께 나간 분들" 카드(자격 통과 최대 4명, "다시 초대" 원터치→selectPartner). 대진DB 개인화 추천으로 검색-only 마찰 완화. 잔여: 대회 탐색 추천(급수·지역 맞춤 대회 추천)만 남음 |

## 실행 로그 (최신 위)
- 2026-07-12 · 하드닝(UI 에러 상태 ④ — 주최자 제어 페이지 로드 실패 복구) · `src/pages/organizer/TournamentManage.jsx`·`src/pages/organizer/EntryManagement.jsx`
  · **자동화를 켜지도 못하게 막던 "무한 스피너"를 주최자 제어 계층에서 제거** — 직전 4런이 선수(MyMatches·Results·
    TournamentDetail)·심판(Scoreboard) UI 로드 에러 상태와 autoDraw 회귀 테스트를 스윕했다. 안티스톨: 같은 로드-에러
    패턴이지만 **아직 미커버였던 주최자 계층**(직전은 선수·심판 화면)으로 확장하되, 대상은 **완주를 실제로 여는
    최상위 제어 화면**으로 골랐다. **선정 이유(티어1·완주 차단, 선수 페이지보다 상위)**: 이전 UI 스윕이 player/referee
    만 덮고 **organizer 페이지는 통째로 미검사**였는데, 코드 실측 결과 주최자의 두 핵심 제어 화면이 무방비였다 —
    `TournamentManage`(305~349행 `load()`: tournaments·categories·approved count 루프·matches·entries)와
    `EntryManagement`(56~130행 `load()`: categories·entries 조인·podium 이력) 둘 다 **최상위 try-catch도 에러 상태도
    없이** 여러 await 를 직렬 실행 → 어느 하나라도 네트워크 flap 으로 throw 하면 `setLoading(false)`(TM:346·EM:101)에
    영영 못 닿아 스피너에 갇힌다(재시도 버튼 없음). 이 두 화면은 **무인 자동 진행 토글·무인 자동 승인·상태 전환·
    대진 자동 생성·정산·캠페인**이 모두 사는 곳이라, 여기서 잠기면 선수 한 명의 화면이 아니라 **대회 전체의 자동화
    제어가 시작조차 불능**(선수 페이지 무한 스피너보다 상위 티어). **실패 시나리오**: 대회 당일 체육관 와이파이 순간
    끊김에 주최자가 관리 화면을 열면 무한 로딩 → 무인 진행을 못 켜고 신청 승인도 못 해 **오케스트레이터가 아예 안
    도는데 원인도 안 보인다**. **구현(선수 페이지 패턴으로 정렬·비파괴)**: 두 페이지의 load 본문 전체를 try-catch 로
    감싸 throw 시 `loadError=true`+`setLoading(false)` 탈출, `let alive` 가드(retryTick 재실행/언마운트 후 setState 방지)+
    성공 경로에 `if(!alive) return`, `retryTick` 상태로 effect deps `[id, retryTick]`, `retryLoad()`(loadError 리셋·
    loading 재점화·retryTick++), 렌더 `if(loading)` 바로 뒤에 loadError 분기(AlertTriangle+"…정보를 불러오지 못했어요·
    인터넷 확인 후 다시 시도"+파랑 "다시 시도" 버튼·초보용 문구). EntryManagement 의 기존 노쇼 예측 내부 try-catch
    (advisory degrade)는 outer try 안에 그대로 두어(자기 catch 로 삼켜 outer 를 안 건드림) 예측 실패가 페이지를 못
    막게 유지, AlertTriangle 을 lucide import 에 추가. 상태 전환·무인 토글·대진 생성·정산·입금 매칭·승인 로직 전부
    불변(grep: TM loadError 271·retryLoad 362·에러 렌더 590 / EM loadError 42·retryLoad 143·에러 렌더 236). `npm test`
    **172/172**·`npx vite build` green. 다음 하드닝 후보: 나머지 주최자 페이지(BracketGenerator·CourtView·Dashboard)·
    선수 Home/Ranking/Profile/Tournaments 동일 패턴·접근성(aria). (주최자 93% 유지 — 자동화 제어 화면 신뢰성 하드닝, 완주 차단 티어1 구멍 봉인)
- 2026-07-12 · 하드닝(테스트 커버리지 — 자동 대진 생성 autoDraw.js 회귀 그물 14개) · `tests/autodraw.test.mjs`(신규)·`tests/_supabase-stub.mjs`(count/head 지원)
  · **완주를 여는 최대 엔진 `autoDraw.js`(C2/C5)의 커밋된 테스트 0 → 14개** — 직전 3런이 UI 로드
    에러 상태(MyMatches·Results·TournamentDetail·Scoreboard)를 스윕했으나 남은 대상은 원장 자체 판정상
    "탐색·조회 후순위" 페이지(Home/Ranking/Profile/Tournaments)뿐이라 **티어1(완주 막는 것)에서 벗어난다**.
    안티스톨: 같은 패턴 4연속 대신 **다른 계층(엔진 회귀 테스트)**으로 전환하되, 대상은 **완주를 실제로
    여는 최상위 엔진**으로 골랐다. **선정 이유(티어1·최대 미보호 자산)**: 코드 실측으로 미테스트 lib 을
    스캔하니 `autoDraw.js`(395줄)만이 실질 엔진인데 커밋된 테스트가 0이었다(나머지 미테스트는 supabase 싱글턴·
    useOnline 훅). autoDraw 는 무인 진행 ON 이고 대회 당일 대진표가 없을 때 stateMachine 의 closed→in_progress
    를 막던 "대진표 없음"을 **자동으로 해소해 대회를 시작시키는 유일 경로**(TournamentManage 자동)이자,
    공개 추첨(BracketGenerator 수동)의 단일 소스라 — 리팩터가 조용히 깨지면 **대회가 시작조차 못 하거나(무인
    완주 정지) 진출 링크·부전승이 틀어져 대진이 오염**된다. **커버(불변식)**: 순수 — `knockoutLabel`(결승/4강/
    8강/r16 폴백)·`makeMatchRow`(기본값·id 자동·전달값 보존)·`buildKnockoutRows`(4팀 진출 링크 pos→ceil(p/2)·
    슬롯 홀짝, **부전승 선진출**: 한 팀만 있는 1R→status='bye'+승자 기록+다음 라운드 슬롯 자동 채움)·
    `enrichEntries`(라벨 조합·MMR 평균·team_name/이름없음 폴백)·`buildDrawPlan`(single_elim 3팀→size4·부전승1·
    pools null / round_robin 전원 한 조 / pool_only 6팀·조3→2조·전원 정확히 1회 배정)·`uuid`(꼴·유일성). DB
    변이 — `persistDrawPlan`(single_elim 3팀 저장=경기3·조0·씨드 기록 / plan·categoryId 없으면 throw 없이 실패
    반환)·`autoGenerateBracket`(**이미 대진표 있으면 exists**로 덮어쓰기 차단=주최자 공개 추첨 보호 / 승인<2팀
    not_enough / round_robin 3팀 created=경기3·조1·조원3, 미승인 pending 제외)·`autoGenerateAllBrackets`(생성/
    스킵/부족 집계). **스텁 확장(테스트 전용·하위호환)**: `_supabase-stub.mjs` 의 `select(cols, opts)` 가
    `{ count:'exact', head:true }`(autoGenerateBracket 의 "대진표 있나" 판정)를 받아 `{ count, data }` 반환 —
    기존 호출부는 opts 미전달이라 동작 불변(158개 회귀 0). `npm test` **172/172**(158+14)·`npx vite build` green.
    배선 확인(autoGenerateAllBrackets→TournamentManage:390·buildDrawPlan/persistDrawPlan→BracketGenerator:103/146).
    다음 하드닝 후보: 선수 Home/Ranking/Profile/Tournaments 로드 에러 상태·drawOptimizer 경계·접근성(aria). (플로우 점수 불변 — 완주 최대 엔진 회귀 그물)
- 2026-07-12 · 하드닝(UI 에러 상태 ③ — 심판 점수판 로드 실패 복구) · `src/pages/referee/Scoreboard.jsx`
  · **심판 완주(점수 입력→대진표 반영)를 막던 "무한 스피너" 제거** — 직전 두 런이 선수 허브
    MyMatches·완주 종점/시작점(Results·TournamentDetail)에 도입한 로드 에러/재시도 패턴을, 원장이
    "다음 하드닝 후보"로 명시한 **referee 화면 빈/에러 상태**로 확장(안티스톨: 직전은 선수 페이지,
    이번은 **심판 계층**·같은 스윕의 다른 화면). **선정 이유(티어1 완주 차단)**: `Scoreboard`
    (/referee/:matchId)는 심판의 **유일한 작업 화면**이자 대회 진행의 병목 — 여기서 점수를 못 넣으면
    경기가 completed 로 안 넘어가 승자 진출·대진표 반영·시상까지 전부 멈춘다. **진단(코드 실측)**:
    `load()`(라인 112)가 최상위 try-catch 없이 `Promise.all`(경기 임베디드 조인·match_events·getUser)을
    실행 → 어느 하나라도 네트워크 flap 으로 throw 하면 `setLoading(false)`(라인 166)에 영영 못 닿아
    스피너에 갇힌다. `loadError` 상태는 있었지만 **"경기를 찾을 수 없어요"(me/!m)만** 세팅했고 throw
    경로는 미처리 + 에러 화면엔 "돌아가기"뿐 재시도 버튼이 없었다. **실패 시나리오**: 체육관 와이파이
    순간 끊김에 심판이 점수판을 새로 열거나 새로고침하면 무한 로딩 → 심판이 점수를 못 넣어 **그 코트의
    경기·이후 라운드가 통째로 정지**(무인 진행의 심판측 완주가 조용히 붕괴). **구현(선수 페이지 패턴으로
    정렬·비파괴)**: load 본문 전체를 try-catch 로 감싸 throw 시 네트워크 에러 문구
    ("경기 정보를 불러오지 못했어요·인터넷 확인 후 다시 시도")+`setLoading(false)`(alive 가드 유지),
    `retryTick` 상태+effect deps `[matchId, retryTick]`, 에러 화면에 AlertTriangle+"다시 시도"
    (loadError 리셋·loading 재점화·retryTick++로 재로드)/"돌아가기" 두 버튼. 점수 입력·이벤트 저장·
    실시간·최종 확정·성공/무경기 경로 전부 불변(grep: retryTick 73·catch 167·다시 시도 453).
    `npm test` **158/158**·`npx vite build` green. 다음 하드닝 후보: 선수 Home/Ranking/Profile/
    Tournaments 동일 패턴·접근성(aria)·bwf.scoreSummary/serviceCourt 테스트. (심판 82%→83% — 완주 병목 화면 신뢰성 하드닝)
- 2026-07-12 · 하드닝(UI 에러 상태 ② — 완주 종점·시작점 선수 페이지 로드 실패 복구) · `src/pages/player/Results.jsx`·`src/pages/player/TournamentDetail.jsx`
  · **선수 완주의 시작(신청)과 끝(결과·급수·상장)을 막던 "무한 스피너" 제거** — 직전 런이 선수 허브
    MyMatches 에 처음 도입한 로드 에러/재시도 패턴을, 원장이 "다음 하드닝 후보"로 명시한 **나머지 선수
    페이지**로 확장(안티스톨: 직전은 MyMatches 한 페이지, 이번은 **다른 두 페이지**·같은 패턴이라 정체가
    아니라 스윕 진행). **선정 이유(티어1 완주 차단)**: 6개 선수 페이지 중 완주를 실제로 막는 건 **결과 종점
    (`Results` — 순위·급수·상장·하이라이트)**와 **신청 시작점(`TournamentDetail` — 신청·결제·챗봇)** 둘이다
    (Home/Ranking/Profile/Tournaments 는 탐색·조회라 후순위). **진단(코드 실측)**: 두 페이지 `load()` 모두
    최상위 try-catch 도 에러 상태도 없이 여러 `await`(getUser·tournaments.single·categories·entries·pools·
    matches / profiles·파트너 이력)를 직렬 실행 → **어느 하나라도 네트워크 flap 으로 throw 하면**
    `setLoading(false)` 에 영영 도달 못하고 스피너에 갇힌다(재시도 버튼도 없음). 게다가 `TournamentDetail`
    은 실패 시 `tournament=null` 이라 **"대회를 찾을 수 없습니다"** 오표시(존재하는 대회를 없다고 오인) →
    선수가 신청 자체를 포기. **실패 시나리오**: 대회 당일 체육관 와이파이 순간 끊김에 결과 화면을 열면
    무한 로딩 → 선수가 자기 순위·급수 반영·상장을 못 봐 완주가 조용히 끊긴다. **구현(MyMatches 패턴으로
    정렬·비파괴)**: 두 페이지의 `load` 를 `useCallback([id])` 로 승격+본문 전체 try-catch(실패 시
    `loadError=true`+`setLoading(false)`), `useEffect(()=>load(),[load])`, `retry`(스피너 재점화+load 재실행)
    신설, 렌더에 `loadError` 분기(AlertTriangle+"…불러오지 못했어요·인터넷 확인 후 다시 시도"+파랑 "다시 시도"
    버튼·초보용 문구) 를 **`!tournament`(진짜 없음) 분기 앞**에 삽입해 네트워크 오류를 "없음" 오표시와 분리.
    기존 내부 try-catch(mmr_history·파트너 이력 degrade)·신청/공유/파트너 로직·성공 경로 전부 불변
    (grep: Results loadError 49·retry 117·에러 렌더 120 / TournamentDetail loadError 39·retry 136·에러 렌더 242).
    `npm test` **158/158**·`npx vite build` green. 다음 하드닝 후보: Home/Ranking/Profile/Tournaments 동일
    패턴 확장·접근성(aria)·referee 화면 빈/에러 상태. (선수 88% 유지 — 완주 종점·시작점 신뢰성 하드닝)
- 2026-07-12 · 하드닝(UI 에러 상태 — 선수 허브 MyMatches 로드 실패 복구) · `src/pages/player/MyMatches.jsx`
  · **선수 완주를 막던 "무한 스피너" 구멍 제거** — 원장이 6런 넘게 "다음 하드닝 후보"로 미뤄 온
    **"UI 빈/로딩/에러 상태 세부"**를 처음으로 잡았다(안티스톨: 직전 여러 런은 전부 LiveDashboard/notify
    **실시간·발송 계층** 또는 **엔진 테스트 커버리지** — 이번은 **선수 페이지의 로드 에러 상태**로 계층·
    실패 모드가 완전히 다르다). **진단(코드 실측)**: `MyMatches`(DoD가 "선수는 화면 하나로 완결"이라
    지목한 핵심 허브 — 체크인·경기 호출 배너·입금 안내·공지함이 모두 여기)의 `load()` 는 **최상위
    try-catch 도, 에러 상태도 없다**(전 선수 페이지가 `errorState=0`으로 확인). Supabase 조회(getUser·
    profiles·entries·checkins·notices·matches·코트 큐)는 여러 번 `await` 하는데, **네트워크 flap·일시
    오류로 어느 하나라도 throw 하면** 예외가 unhandled rejection 으로 새어 `setLoading(false)`(라인 352)
    에 **영영 도달하지 못하고 화면이 스피너에 갇힌다** — 재시도 버튼도 없다. 실패 시나리오: 대회 당일
    체육관 와이파이가 순간 끊긴 채 선수가 앱을 열면 MyMatches 가 무한 로딩 → **경기 호출 배너를 못 받고
    체크인도 못 해 노쇼 처리**(무인 near-zero touch 의 선수측 완주가 조용히 붕괴, "완주를 막는 것" 최우선
    티어). **구현(비파괴)**: `load()` 본문 전체를 try-catch 로 감싸 실패 시 `loadError=true`+
    `setLoading(false)`(스피너 탈출) 폴백, `loadError` 상태·`retry`(스피너 다시 띄우고 load 재실행,
    액션 후 조용한 재조회 UX 는 loading(true) 를 load 시작이 아니라 retry 에만 둬 그대로 유지) 추가,
    렌더의 `{loading ? 스피너 : (…)}` 를 `{loading ? 스피너 : loadError ? 에러화면 : (…)}` 로 확장
    (AlertTriangle+"정보를 불러오지 못했어요·인터넷 확인 후 다시 시도"+파랑 "다시 시도" 버튼, 초보용
    문구). load 성공/무유저 경로·실시간 구독·체크인/입금/파트너 로직 전부 불변(retry 만 신설, grep 으로
    loadError line 236·retry 367·에러 렌더 611 배선 확인). `npm test` **158/158**·`npx vite build` green.
    다음 하드닝 후보: 나머지 선수 페이지(Results/Profile/TournamentDetail/Tournaments)·Home/Ranking 로드
    에러 상태(동일 패턴 확장)·접근성(aria). (선수 88% 유지 — 완주 신뢰성 품질 하드닝)
- 2026-07-12 · 하드닝(실시간 복원력 ③ — 체크인 탭 뷰 구독 폴링·재연결 + 스테일 종목 버그 수정) · `src/pages/organizer/LiveDashboard.jsx`
  · **앱의 마지막 무폴백 실시간 구독(체크인 탭 뷰) 정렬 + 잠복 버그 수정** — 원장이 6런 넘게 "다음
    하드닝 후보"로 미뤄 온 **"checkins(체크인 탭 뷰) 구독 폴링"**을 잡았다(안티스톨: 직전 두 런은
    notify.js **발송** 배치화, 이번은 LiveDashboard 체크인 **뷰 구독** — 다른 계층·다른 실패 모드).
    **진단(코드 실측)**: 앱의 모든 실시간 구독(LiveScore·CourtView·CourtReferee·LiveDashboard의
    matches·checkinset)이 이미 15초 폴링 폴백 + 재연결 따라잡기를 갖췄는데, **유일하게** `checkins-${id}`
    구독(체크인 탭, viewMode==='checkin')만 (1)`.subscribe()` 에 status 핸들러가 없어 재연결 따라잡기
    전무, (2)폴링 폴백 없음이었다 — 체크인 탭을 열어 둔 운영자 화면에서 realtime 이 조용히 끊기면
    새 셀프 체크인이 목록에 안 뜬다(뷰 전용이라 무인 노쇼 판정엔 영향 없으나 운영자 모니터링이 낡음).
    게다가 **잠복 버그**: 구독 핸들러 `() => loadCheckins()` 는 effect deps 가 `[viewMode, id]` 뿐이라
    **체크인 탭에서 종목 탭(activeCat)을 바꿔도 재구독되지 않아**, 그 뒤 도착한 realtime 이벤트가
    **직전 종목**의 loadCheckins 클로저로 목록을 덮어써 엉뚱한 종목 참가자가 표시될 수 있었다.
    **구현(matches·checkinset 패턴으로 정렬)**: (a) `loadCheckinsRef`(render마다 최신 loadCheckins 할당)로
    reload 를 참조 고정 — 종목 탭을 바꿔도 구독을 다시 열지 않고 항상 현재 activeCat 기준으로 새로고침
    (스테일 종목 버그 수정), (b) 15초 폴링 `setInterval(reload, REFRESH_MS)`, (c) `.subscribe(status=>…)`
    에서 SUBSCRIBED 시 끊겼다 복귀면(local dropped) reload 따라잡기·CHANNEL_ERROR/TIMED_OUT/CLOSED 시
    dropped 표시, cleanup 에 clearInterval. 비파괴적(loadCheckins·loadCheckinSet·checkinset 구독·오케스트레이터
    전부 불변, 체크인 뷰 구독 내부만 강화). `npm test` **158/158**·`npx vite build` green. 이로써 앱의 전
    실시간 구독이 폴링·재연결 복원력을 갖춤(실시간 하드닝 스윕 완료). 다음 하드닝 후보: UI 빈/로딩/에러
    상태 세부·bwf.scoreSummary/serviceCourt 테스트·접근성(aria). (C4 품질 하드닝 — 플로우 점수 불변)
- 2026-07-12 · 하드닝(C1 재알림·경고 배치화 — 무인 노쇼 경로 채널·insert 낭비 제거) · `src/lib/notify.js`·`src/pages/organizer/LiveDashboard.jsx`·`tests/notify.test.mjs`
  · **무인 노쇼 경로(재알림·경고)의 채널 개폐·insert 낭비 제거** — 직전 런이 toCall/toSoon 순차
    await 직렬 지연을 `callMatchBatch` 로 잡았고 원장이 "다음 후보: recall/warn 도 배치화"를
    명시했다(안티스톨: 같은 cluster·같은 배치 인프라지만 **다른 코드 경로**—직전은 planAutoAdvance
    의 호출/사전알림 순차 await 지연, 이번은 planNoShow 의 재알림/경고 fire-and-forget forEach 의
    **채널·insert 낭비**, 다른 실패 모드라 정체가 아니라 다음 슬라이스). **진단(코드 실측)**: LiveDashboard
    노쇼 useEffect(10초 틱)는 `plan.toRecall` 을 낱개 `callMatch`, `plan.toWarn` 을 낱개
    `callWalkoverWarn` 로 forEach 발송했다. 이 둘은 순차 await 가 아니라 fire-and-forget 동시
    실행이라 **직렬 지연은 없지만**, 각 호출이 `broadcast()` 에서 **새 Supabase 채널을 열고
    SUBSCRIBED 를 기다린 뒤 send→removeChannel + persist insert 1회** 한다. 라운드 전환 등으로
    **여러 경기가 한꺼번에 무응답(재알림/경고 대상)이 되면** 그 수만큼 채널을 동시에 열고 닫고
    insert 를 N회 해 realtime 연결·DB 왕복을 낭비한다(직전 런이 toCall/toSoon 에서 없앤 것과 같은
    낭비가 노쇼 경로엔 남아 있었음). **구현(비파괴)**: notify.js `buildCallBatchItems`/`callMatchBatch`
    에 `warns`(각 {match,court,sport,secondsLeft,recipients} → `buildWalkoverWarn` 페이로드,
    kind:'warn') 인자 추가(기존 calls/soons 불변). LiveDashboard 는 재알림·경고 두 forEach 를
    `callMatchBatch({tournamentId, calls:재알림, warns:경고})` 단일 호출로 대체 — 재알림은 호출
    반복이라 calls(buildMatchCall)로, 경고는 warns(buildWalkoverWarn)로 묶어 **대회 채널 하나·insert
    한 번**에 발송. refs(recalledRef count 증가·warnedRef)는 기존처럼 **발송 전에 먼저 찍어** 다음
    틱 중복 발송 차단(원 호출 시각 calledIds 불변→부전승 카운트다운 그대로), 로그는 배치 resolve 후
    경기별로. 수동 `callMatch`(handleCall)·순수 planNoShow 판정 불변, `callWalkoverWarn` export 는
    유지(공개 API 보존, LiveDashboard 미사용이라 import 에서만 제거). `npm test` **158/158**(신규 2:
    buildCallBatchItems warns·callMatchBatch calls+warns 단일 채널), `npx vite build` green. 다음 하드닝
    후보: UI 빈/로딩/에러 상태·checkins(체크인 탭 뷰) 구독 폴링·referee 화면 빈/에러 상태. (운영 88% 유지 — 무인 노쇼 경로 채널·연결 낭비 제거 하드닝)
- 2026-07-12 · 하드닝(C1 배치 발송 — 무인 자동 호출 직렬 지연 제거) · `src/lib/notify.js`·`src/pages/organizer/LiveDashboard.jsx`·`tests/notify.test.mjs`
  · **무인 오케스트레이터의 다중 호출 직렬 지연(notify broadcast 순차 send) 제거** — 원장이 6런 넘게
    "다음 하드닝 후보"로 미뤄 온 **"notify broadcast 순차 send 직렬 지연"**을 실제로 잡았다(직전 두 런은
    LiveDashboard 실시간 구독 하드닝 — 안티스톨상 같은 화면이라도 다른 계층: 이번은 notify.js 발송 경로).
    **진단(코드 실측)**: `runOrchestrator` 의 `plan.toCall`·`plan.toSoon` 루프는 경기마다 `await callMatch`/
    `await callMatchSoon` 를 **순차** 실행했고, 각 호출은 `broadcast()` 에서 **새 Supabase 채널을 열고
    SUBSCRIBED 를 최대 2초 기다린 뒤** send→removeChannel 한다. 라운드 전환 등으로 **코트가 여러 개 한꺼번에
    비면** 호출이 직렬로 밀려 마지막 코트는 최악 N×2초 늦게 호출된다(무인 near-zero touch 의 체감 지연 —
    빈 코트가 그만큼 더 오래 논다). 게다가 채널을 N번 열고 닫아 realtime 연결도 낭비. **구현(비파괴)**:
    notify.js 에 (a) `waitSubscribed(ch)` 추출(구독 대기 공용화 + **SUBSCRIBED 시 setTimeout clearTimeout**
    으로 매달린 2초 타이머 정리), (b) `notificationRow(payload,rid)` 추출(persist 행 스키마 단일 소스),
    (c) `broadcastBatch(tournamentId,payloads)` — **채널 하나만 구독(대기 1회)해 전 페이로드를 연달아 방송**,
    (d) `persistBatch(items)` — 전 항목 행을 **한 번의 insert** 로 저장, (e) 고수준 `callMatchBatch({calls,soons})`
    + 순수 `buildCallBatchItems`(테스트용). LiveDashboard 의 toCall/toSoon 두 순차 루프를 `callMatchBatch`
    한 번 호출로 대체 — 배치 성공 시에만 calledIds/soonSentRef 를 일괄 갱신(실패 시 다음 틱 재시도, 기존
    per-match try/catch 의미 유지). 낱개 `callMatch`(수동 호출 버튼·재호출 루프)·`callWalkoverWarn`(노쇼 경고)는
    불변. `broadcast`/`persist` 도 새 헬퍼로 리팩터했으나 동작 동일. `npm test` **156/156**(신규 6: notificationRow
    2·buildCallBatchItems 2·callMatchBatch 2), `npx vite build` green. 다음 하드닝 후보: recall/warn 도 배치화·
    UI 빈/로딩/에러 상태·checkins(뷰 전용) 구독 폴링. (운영 88% 유지 — 무인 호출 지연·연결 낭비 제거 하드닝)
- 2026-07-12 · 하드닝(실시간 복원력 ② — 체크인 채널 재연결·폴링 폴백) · `src/pages/organizer/LiveDashboard.jsx`
  · **무인 노쇼 자동 부전승의 데이터 소스(체크인 채널) 복원력** — 직전 런이 LiveDashboard 의
    `matches` 구독을 하드닝(필터·재연결 따라잡기·폴링 폴백)했고 원장이 "다음 후보"로 명시한
    **checkinset 구독 재연결 따라잡기 확장**을 이번에 잡았다(안티스톨: 같은 화면이지만 다른
    구독·다른 실패 모드). **진단(코드 실측)**: `checkinset-${id}` 구독(177~188행)은 바로 옆의
    `matches` 구독과 달리 여전히 (1)`.subscribe()` 에 status 핸들러가 없어 **재연결 따라잡기 전무**,
    (2)폴링 폴백 없음이었다. 이 구독이 갱신하는 `checkinSet` 은 **노쇼 자동 부전승 판정
    (`checkin.assessNoShowResolution`)의 유일한 입력**이다. 실패 시나리오: 선수가 폰으로 셀프
    체크인 → 그 직전 랩톱 절전·모바일 네트워크로 checkinset 채널이 조용히 끊겨 있으면 그 체크인
    이벤트를 영영 못 받아 `checkinSet` 이 낡은 채로 굳는다 → overdue 진입 시 `assessNoShowResolution`
    이 "온 팀"을 미체크인으로 오판(present=false) → **resolvable=false 로 자동 부전승이 발화하지
    않고 경기가 멈춰 사람 개입 필요**(무인 노쇼 처리의 핵심이 조용히 정지). 게다가 `matches` 채널만
    붙어 있으면 운영자에게는 "실시간 연결됨"으로 보여 **체크인 채널이 죽은 걸 눈치챌 방법도 없었다**.
    (`useOnline` 은 브라우저 오프라인→온라인만 잡고, 채널만 조용히 끊기는 경우는 못 잡음.)
    **구현**: `matches` 와 동일 패턴으로 정렬 — checkinset 구독에 (a)15초 폴링 폴백
    (`setInterval(loadCheckinSet, REFRESH_MS)`), (b)`.subscribe(status=>…)` 에서 SUBSCRIBED 시
    `checkinRtState='connected'`+끊겼다 복귀(`checkinDropRef`)면 loadCheckinSet 따라잡기,
    CHANNEL_ERROR/TIMED_OUT/CLOSED 시 'connecting'+drop 표시. ConnectionStatus 는 이제 **두 채널
    모두 연결돼야** `live=true`("실시간 연결됨") — 체크인 채널만 끊겨도 "재연결 중…"+"15초마다
    자동 새로고침 중" 으로 운영자가 인지. 비파괴적(matches 구독·오케스트레이터·노쇼/시상 확정 트리거
    전부 불변, checkinset 구독 내부만 강화). `npm test` 150/150·`npx vite build` green. 다음 하드닝
    후보: checkins(체크인 탭 뷰) 구독 폴링(뷰 전용이라 무인 비핵심)·UI 빈/로딩/에러 상태·notify
    broadcast 순차 send 직렬 지연. (운영 88% 유지 — 무인 노쇼 처리 안정성 하드닝)
- 2026-07-11 · 하드닝(실시간 복원력 — 무인 진행 트리거 안정화) · `src/pages/organizer/LiveDashboard.jsx`
  · **무인 오케스트레이터의 realtime 구독 하드닝** — 직전 다섯 런이 전부 순수/의존 엔진 회귀 테스트
    (36→150개)였다. 안티스톨 규칙(같은 항목 2연속 금지)에 따라 이번엔 원장이 매 런 "다음 후보"로
    미뤄 온 **"실시간 구독 경쟁조건"**을 실제 코드에서 잡았다. **진단(코드 실측)**: 라이브 화면 4곳 중
    LiveScore·CourtView·CourtReferee 는 구독 핸들러에서 `catIdsRef.has(row.category_id)`로 클라이언트
    필터를 걸고 CourtReferee 는 rtState·hadDropRef·15초 폴링으로 **재연결 따라잡기**까지 갖췄는데,
    정작 **무인 자동 진행의 핵심 화면인 LiveDashboard** 만 (1)matches 구독에 필터가 없어 `event:'*',
    table:'tournament_matches'` 전역 변경마다(=동시 진행되는 타 대회·타 종목의 모든 점수 이벤트마다)
    무거운 조인 `loadMatches` 를 재실행하고, (2)재연결 복구가 전혀 없었다. LiveDashboard 의 무인
    오케스트레이터는 `[matches]` 이펙트에서 `if(autoRun) runOrchestrator(matches)` 로 도는데, 그
    트리거가 오직 realtime matches 갱신이라 — 랩톱 절전·모바일 네트워크로 채널이 조용히 끊기면
    **자동 호출·빈코트 투입·노쇼 타이머·시상 확정이 아무 신호 없이 영구 정지**했다(무인 near-zero
    touch 의 치명적 구멍, 하드닝 목록의 "race conditions in realtime"). **구현**: 다른 라이브 화면과
    동일 패턴으로 정렬 — 구독 핸들러가 `payload.new ?? payload.old` 의 category_id 가 activeCat 이
    아니면 무시(재조회 폭주 제거·재구독 없이 클로저 activeCat 사용), `.subscribe(status=>…)`에서
    SUBSCRIBED 시 rtState='connected'+끊겼다 돌아왔으면(hadDropRef) loadMatches 따라잡기, CHANNEL_ERROR/
    TIMED_OUT/CLOSED 시 'connecting'+hadDropRef 표시, 15초 폴링 폴백(REFRESH_MS, realtime 이 죽어도
    오케스트레이터가 계속 도는 안전망) 추가, useOnline 로 오프라인→온라인 복구 시 loadMatches·
    loadCheckinSet 재조회, loadMatches 가 lastSync 스탬프. 무인 자동 진행 패널에 ConnectionStatus
    (실시간 연결됨/재연결 중…/오프라인·마지막 동기화 시각) 상시 표시 — 무인 진행이 실제로 연결돼
    있는지 운영자가 눈으로 확인. 비파괴적(기존 orchestrator·노쇼·시상확정 트리거 배선 전부 불변,
    구독 내부만 강화). `npm test` 150/150·`npx vite build` green. 다음 하드닝 후보: checkinset/checkins
    구독에도 재연결 따라잡기 확장·UI 빈/로딩/에러 상태·notify broadcast 직렬 지연(순차 send 2초 대기). (운영 87%→88%)
- 2026-07-11 · 하드닝(테스트 커버리지 확장 ⑤ — 커뮤니케이션 레이어 notify/campaign) · `scripts/ext-loader.mjs`(load 훅+supabase 리다이렉트 추가)·`tests/_supabase-singleton-stub.mjs`(신규)·`tests/notify.test.mjs`(신규)
  · C1 경기 호출 인프라(notify.js)와 C11 사후 캠페인(campaign.js)에 회귀 테스트 29개 추가 —
    직전 네 런이 순수 엔진(engines 36+engines2 27+engines3 35)과 supabase 의존 advance.js(23)까지 덮어
    98→121개를 커밋했지만, **북극성이 "가장 큰 공백"으로 지목한 C1 호출 인프라와 C11 캠페인 두 엔진은
    여전히 커밋된 테스트가 0**이었다(직전 로그가 "다음 후보: notify/campaign(신설 스텁 재사용)"로 명시).
    이유: notify.js 는 유일하게 (1) Vite 전용 `import.meta.env`(VITE_ENABLE_PUSH·DEV) 를 모듈 최상위에서
    읽고 (2) 실 Supabase 싱글턴(`import { supabase } from './supabase'`, @supabase/supabase-js+env 의존)을
    끌어와, 순정 Node ESM 에서 **임포트 자체가 TypeError**(env)·**모듈 없음**(supabase-js 미설치)으로 불가했다.
    campaign.js 는 `{CAMPAIGN} from './notify'` 를 임포트하므로 같이 막혔다. advance.js 는 supabase 를 인자로
    받아 스텁 주입이 됐지만, notify 는 싱글턴 직접 의존이라 다른 접근이 필요했다. **깨지면 선수가 엉뚱한
    코트로 불려가거나(잘못된 court/body)·때 아닌 안내가 나가거나(campaign due 오판)·미참가자에게 발송
    (수신자 오집계)** 되는 무인 커뮤니케이션의 핵심이라, 하드닝 모드 최고가치 슬라이스.
    **해결(테스트 전용·소스/Vite 불변)**: ext-loader 에 두 훅 추가 — (a) `load` 훅이 `import.meta.env` 토큰을
    가진 소스 .js 를 `(globalThis.__VITE_ENV__ ?? {})` 로 치환(실제 대상은 notify.js 하나, 토큰 없는 파일은
    기본 로더 위임 → 기존 121 테스트 불변), (b) `resolve` 훅이 확장자 없는 `./supabase` 상대 임포트를
    `tests/_supabase-singleton-stub.mjs`(신규, `makeSupabase({})`+채널 no-op)로 리다이렉트. notify 가 유일
    싱글턴 임포터라(grep 확인) 다른 테스트에 영향 0. 커버(불변식): **notify**(notifyChannel 발신=수신 이름,
    NOTICE_TYPES 지속형만·전송성 호출 제외, buildMatchCall court 인자>match.court_number 폴백>null 현장안내·
    entryIds null 제거, buildMatchSoon aheadCount 숫자보존/비숫자 null·코트 유무 문구, buildWalkoverWarn
    초→분 올림 90s=2분·30s=최소1분·음수 0클램프·secondsLeft 없음 "지금 바로"·코트 없음 폴백), **campaign**
    (localDateStr 로컬자정, dayDiff 내일/오늘/어제·datetime 앞10자·슬래시/불가 null, planCampaigns 상태머신
    open|closed+D1→전날/closed|in_progress+D0→당일/open+D0 무발송/D-2 무발송/completed→감사+설문 날짜무관/
    sent 집합 표기/null 안전, pendingCampaigns sent 제외, markCampaignSent·loadSentCampaigns 중복안전·대회격리,
    fetchCampaignRecipients approved만·player1/2 중복제거·빈ids []·실패 [] degrade). `npm test` → **150/150**
    (기존 121 + 신규 29), `npx vite build` green(deps 설치 후). 신설 싱글턴 스텁·env shim 은 향후 UI/훅
    레이어 테스트에도 재사용 가능. 다음 하드닝 후보: bwf.scoreSummary/serviceCourt 세부·notify send 경로
    (broadcast/persist 채널 목)·UI 빈/로딩/에러 상태·실시간 구독 경쟁조건. (플로우 점수 불변 — 품질 하드닝)
- 2026-07-11 · 하드닝(테스트 커버리지 확장 ④ — supabase 의존 엔진) · `tests/_supabase-stub.mjs`(신규)·`tests/advance.test.mjs`(신규)
  · 최고위험 엔진 `advance.js`(DB 변이 경로)에 회귀 테스트 23개 추가 — 직전 세 런이 순수 엔진
    (engines.test.mjs 36 + engines2 27 + engines3 35 = 98)을 덮었지만, **깨지면 조용히 잘못된 팀이 본선
    진출(=엉뚱한 시상)하거나 순위가 틀어지는** advance.js 의 DB 변이 로직(completeMatch·advanceWinner·
    checkPoolStageComplete·seedKnockoutFromPools·finalizeRanks·finalizeTournament)은 supabase 의존이라
    커밋된 테스트가 순수 `planTeamForfeit` 하나뿐이었다(직전 세 런 로그가 "다음 후보: advance.advanceWinner/
    completeMatch(supabase 의존)"로 명시). 이 엔진이 승자 진출·조별→본선 시딩·최종 순위·시상 확정 전체를
    구동하므로, 무인 실행이 리팩터하다 깨면 대회 결과 자체가 조용히 오염된다 — 하드닝 모드 최고가치 슬라이스.
    supabase 의존 엔진을 테스트하려면 목이 필요해, 재사용 가능한 **인메모리 Supabase 스텁**(`_supabase-stub.mjs`)을
    신설: PostgREST 체이닝 표면 중 엔진이 실제 쓰는 부분(from/select+임베디드조인 `alias:child(*)`/eq/in/order/
    single/update/insert/delete/rpc)만 흉내내는 thenable 쿼리 빌더 + `_db`(상태 확인)·`_rpcCalls`(RPC 호출 검사).
    이 스텁은 다음 하드닝 후보(notify/campaign·나머지 advance 함수)도 그대로 재사용 가능. `tests/*.test.mjs`
    자동 발견 러너에 **새 파일 2개만 추가**(소스·기존 테스트 불변 → 회귀 위험 0), 각 단언은 tournament.js
    (generatePools/calculatePoolStandings/determineAdvancements/generateKnockoutBracket) 조합을 실측 트레이스.
    커버(불변식): **advanceWinner**(slot1→team1·slot2→team2·next 없거나 승자 없으면 false 무변이),
    **completeMatch**(normal: status=completed·승수·라이브캐시(live_*) 리셋·3세트 저장·승자 다음경기 진출·
    apply_match_mmr RPC 단일진입점·반환계약 / walkover: status=forfeited·forfeit_team·**walkover여도 RPC 무조건
    호출**(제외판정은 RPC 전담)·상대 진출 / 게임 미제공 시 점수저장 생략·타경기 점수 불변 / **MMR RPC 실패해도
    throw 안 하고 mmrError 반환**(점수·진출은 확정) / 없는 경기 throw), **checkPoolStageComplete**(미완료 false·
    풀없음 false·pool_only 전부완료 true / **pool_knockout 전부완료 시 본선 시딩까지 실행**), **seedKnockoutFromPools**
    (2조 각 1위(A1·B1) 본선 배정·pool_rank 기록 / **멱등: 이미 배정 시 alreadySeeded·pool_rank 불변**),
    **finalizeRanks**(녹아웃 우승1·준우승2·준결승패자 공동3위·rank오름차순 반환 / 미완료 throw / 결승 승자없음 throw /
    경기없음 [] / 리그전(풀테이블 없음) 조순위 순차), **finalizeTournament**(final_rank 확정+status=completed+
    **공인대회(cert_level≠none)만 promote_grades_v2 RPC**·비공인 미호출·미완료 throw 시 상태전환 안 됨). `npm test`
    → **121/121 통과**(기존 98 + 신규 23), `npx vite build` green(deps 설치 후). 다음 하드닝 후보: notify/campaign
    (신설 스텁 재사용)·bwf.scoreSummary 세부 + UI 빈/로딩/에러 상태·실시간 구독 경쟁조건. (플로우 점수 불변 — 품질 하드닝)
- 2026-07-11 · 하드닝(테스트 커버리지 확장 ③) · `tests/engines3.test.mjs`(신규)
  · 경쟁 무결성·레이팅·입금 매칭 3대 최고위험 엔진에 회귀 테스트 35개 추가 — 직전 두 런이 판정
    엔진(engines.test.mjs 36) + 나머지 순수 엔진(engines2.test.mjs 27)을 덮었지만, **깨지면 조용히
    잘못된 팀이 진출(=엉뚱한 시상)·레이팅이 틀어짐·엉뚱한 입금이 자동 확인되는** 최고위험 엔진 3종은
    여전히 커밋된 테스트가 0이었다(직전 로그가 "다음 후보: payment.matchDeposits·tournament.generatePools·
    mmr"로 명시). 기능 백로그가 human-gated로 소진된 하드닝 모드에서 북극성 "never regressed"를 지킬
    최고가치 슬라이스. `tests/*.test.mjs` 자동 발견 러너에 **새 파일만 추가**(소스·기존 테스트 불변 →
    회귀 위험 0), 각 단언은 소스 실측 트레이스. 커버: **tournament**(generatePools 빈/RangeError/조
    이름·개수/스네이크 시드 균형·무작위 재현성, calculatePoolStandings 승패·게임/점수 득실 집계·**표준
    타이브레이커 승자승 우선(a>b)** vs **득실 우선(b>a)**·3자 동률 승자승 미적용(순환 방지)·무경기 순번,
    determineAdvancements 직행+와일드카드 득실순·WC0, countActualAdvancers 균형/불균형 풀 상한·
    knockoutSkeletonSize nextPow2/진출<2=0, generateKnockoutBracket 진출<2=[]/3팀 size4 부전승1건 라운드,
    prizeLabel 시상범위, formatSummary format_label 우선·조별+토너먼트 합성), **mmr**(CERT_LEVELS K계약,
    partnerAdjustment 강/약 파트너·상하한 클램프, teamMMR 반올림, calcMMRDelta none0/동급±/신규 1.5배,
    resolveMatchMMR none 전원0·복식 동급 대칭·after 하한100), **payment**(normalizeName 괄호/꼬리숫자/공백,
    parseAmount 콤마/통화/실패, nameSimilarity 동일1/포함0.9/오타 부분점수, parseDeposits 날짜라인 최대금액,
    matchDeposits 정확확인·부족/오타 review·미매칭/미사용 분리·무료/확정/철회/환불 제외·null 안전).
    `npm test` → **98/98 통과**(기존 63 + 신규 35), `npx vite build` green. 다음 하드닝 후보: notify/campaign
    (supabase 스텁 주입 필요)·advance.advanceWinner/completeMatch(supabase 의존)·bwf.scoreSummary 세부 +
    UI 빈/로딩/에러 상태·실시간 구독 경쟁조건. (플로우 점수 불변 — 자동화 기능이 아니라 품질 하드닝)
- 2026-07-11 · 하드닝(테스트 커버리지 확장) · `tests/engines2.test.mjs`(신규)
  · 미커버 순수 엔진 12종에 회귀 테스트 27개 추가 — 직전 런이 커밋한 회귀 테스트 그물(`engines.test.mjs`,
    36개)이 자동화 "판정" 엔진(bwf·scheduler·stateMachine·orchestrator.planNoShow·advance·noshowPredict·
    checkin·sandbag·reliability)만 덮고 있어, 나머지 자동화 엔진들은 여전히 무방비였다(직전 런 로그가
    "다음 하드닝 후보"로 명시). 기능 백로그가 human-gated로 소진된 상태에서 북극성 "매 실행 strictly
    better·never regressed"를 지킬 최고가치 슬라이스는 이 그물을 넓히는 것 — 이후 무인 실행이 정산·대진
    최적화·자격 게이트 같은 엔진을 리팩터하다 깨도 즉시 잡힌다. `tests/*.test.mjs` 자동 발견 러너에 새 파일만
    추가(기존 파일·소스 불변 → 회귀 위험 0). 각 단언은 소스 실측으로 트레이스. 커버: **settlement**
    (computeSettlement 확인수입만 income·환불/미수금 손익 밖·경비+상금 지출·순손익·byCat, presetByKey 폴백,
    formatWon 음수), **deposit**(shouldShowDeposit 무료/파트너대기/철회 제외, depositGuide 무료/확인/환불/대기
    톤·payerName·파트너 노트), **drawOptimizer**(poolMeanMmr, scoreDraw spread·sizeSpread 벌점, candidateSeeds,
    optimizeDraw seeded/balanced, explainDraw no-mmr/mmr), **planWizard**(distributePools 고른분배,
    estimateMatches RR/SE/PK, defaultMatchMinutes, recommendSetup ≤5/≤8/12팀, estimateSchedule endTime,
    formatDuration), **certificate**(certRankInfo 범위 안/밖, koreanDate, buildCertificate issueNo,
    buildCertificates 필터+정렬), **record**(opponentPlayers 나제외·게스트폴백, computeCareerRecord 승패/부전/
    세트/상대전적/대회수/승률, hasCareerRecord), **discover**(regionTokens 특별시 중복제외, preferredRegions,
    ddayOf, recommendTournaments 접수중·미신청·자격·미래만+지역/마감 근거), **partners**(collectPastPartners
    집계·정렬, rankPartnerSuggestions 자격우선, partnerReason), **highlight**(computePlayerStats 풀세트·명장면·
    완승, winRate, buildPlayerHighlight null/우승헤드라인/mmrDelta, highlightShareText), **orchestrator**
    (planAutoAdvance 빈코트 자동호출·사전알림, planRebalance 유휴→과부하 이동·중복출전 방지, analyzeDelay
    관측페이스·onTrack), **chatbot**(normalize, matchTopic, askBot personal/faq/fallback, suggestedQuestions),
    **grades**(checkEligibility 화이트리스트/레거시/MMR 게이트, awardPoints, checkPromotion 승급·강등없음,
    promotionProgress). `npm test` → 63/63 통과(기존 36 + 신규 27), `npx vite build` green. 다음 하드닝
    후보: notify/campaign(supabase 스텁 주입)·payment.matchDeposits(퍼지매칭)·tournament.generatePools·
    mmr·advance.advanceWinner 등 supabase/난수 의존 엔진 + UI 빈/로딩/에러 상태·실시간 경쟁조건.
    (플로우 점수 불변 — 자동화 기능이 아니라 품질 하드닝)
- 2026-07-11 · 하드닝(자체 테스트) · `scripts/ext-loader.mjs`(신규)·`scripts/run-tests.mjs`(신규)·`tests/_harness.mjs`(신규)·`tests/engines.test.mjs`(신규)·`package.json`(test 스크립트)
  · 순수 엔진 회귀 테스트 스위트 커밋 — 비-human-gated 기능 백로그가 소진된 상태(남은 ⚠️ 잔여는 전부
    외부 발송·PG·실LLM·클럽/계좌 필드·심판 셀프스코어 RLS 등 human-gated)에서, 북극성 원칙 "매 실행 repo를
    strictly better·never regressed"를 지키기 위한 하드닝(마스터 프롬프트 하드닝 목록의 "self-tests")을
    선택. **진단**: 지금껏 매 실행 로그가 "node 자체 검증 통과 / 29개 시나리오"를 주장했지만 그 테스트는
    전부 일회성(esbuild로 번들해 돌리고 버림)이라 커밋된 테스트가 **0건**이었다 — 이후 무인 실행이 공유
    엔진(scheduler/bwf/advance/stateMachine 등)을 리팩터하다 판정을 깨도 자동으로 잡을 그물이 없었다(무인
    진행이 조용히 오작동할 수 있는 최대 품질 공백). **구현**: 의존성 0으로 동작하는 테스트 인프라 신설 —
    (1) `scripts/ext-loader.mjs`(엔진들의 확장자 없는 상대 임포트 `./grades`를 Node ESM에서 해석하도록 실패
    시 `.js` 보완하는 로더 훅, 소스는 불변·Vite 동작 불변), (2) `tests/_harness.mjs`(node:assert/strict 기반
    초경량 test/run), (3) `scripts/run-tests.mjs`(tests/*.test.mjs 로드→실행→실패 시 exit 1), (4)
    `tests/engines.test.mjs`(자동화 핵심 엔진 36개 테스트). 커버: **bwf**(isGameOver 2점차·듀스·골든/
    isIntervalPoint/applyPoint 게임·매치 종료·서브권/applyForfeit/serviceCourt/foldEvents 언두/matchCall
    게임·매치포인트·듀스·골든·무콜/scoreSummary), **scheduler**(buildSingleElimination 부전승·buildRoundRobin·
    scheduleMatches 코트 배정·**rescheduleAfterForfeit**), **stateMachine**(planTournamentState open→closed
    마감/정원·closed blockReason·in_progress 전환·finish auto:false / planAutoFinalize 유예 / planAutoApprovals
    auto·payment·review·capacity), **orchestrator.planNoShow**(waiting→recall→warned→overdue·max·제외),
    **advance.planTeamForfeit**(toForfeit/toVacate), **noshowPredict**(predict 티어·buildNoShowIndex 대회단위
    중복방지·entryNoShowRisk·recommendWaitlist·worseNoShow), **checkin**(getCheckinWindow·assessSelfCheckin·
    assessNoShowResolution·summarizeCheckins), **sandbag**(assessSandbag gap·표본부족 완화·worseLevel),
    **reliability**(tier·isRanked·calcReliability 만점/빈). `npm test` → 36/36 통과, `npx vite build` green,
    소스/페이지 변경 0(순수 추가라 회귀 위험 0, 기존 트리거 배선 grep 유지 확인). 다음 하드닝 후보: 미커버
    엔진(drawOptimizer·planWizard·settlement·deposit·highlight·record·discover·partners·certificate·chatbot·
    mmr·grades·tournament) + orchestrator planAutoAdvance/planRebalance/analyzeDelay + notify/campaign(supabase
    스텁 주입 필요) 테스트 확장. (플로우 점수 불변 — 자동화 기능이 아니라 품질 하드닝)
- 2026-07-11 · C7(AI 예측) · `src/lib/noshowPredict.js`(신규)·`src/pages/organizer/EntryManagement.jsx`
  · 노쇼(불참) 예측 · 예비명단/오버부킹 추천 — 북극성 AI 차별화 목록 #5("노쇼 예측 — 과거 패턴
    기반 오버부킹/예비명단")를 채운 순수 AI 판단 레이어. 비-human-gated 잔여가 사실상 소진된
    상태(남은 ⚠️ 조각은 전부 외부 발송·PG·실LLM·클럽/계좌 필드 등 human-gated, 심판 셀프스코어는
    RLS 마이그레이션 적용이 선행돼야 발화)에서, 스키마·외부 키 없이 즉시 출하 가능한 AI 차별화
    슬라이스를 선택. 지금껏 접수·승인 단계는 "누가 당일 안 나올지"에 대한 예측이 전혀 없어, 정원이
    찬 인기 대회에서 노쇼로 빈 코트가 생겨도 미리 예비팀을 확보해 둘 근거가 없었다(운영·주최자
    낭비). 순수 엔진 `noshowPredict.js` 신설 — `buildNoShowIndex({historyEntries,matches})`
    (신청자들의 과거 전 신청(entry→선수)과 완료/부전 경기를 대회 단위로 접어, 선수별 참가 대회 수
    (appearances)와 그 중 불참(result_type='walkover', forfeit_team로 귀속)으로 처리된 대회 수
    (noShows)를 집계 — 한 대회의 여러 walkover 경기를 1회로 묶어 조별 부전패로 rate가 과장되는 것
    방지, bye/미완료 제외, tournament_id는 category join 또는 직접 필드 폴백, walkover만 노쇼로
    보고 retired/disqualified는 제외), `predictNoShow({appearances,noShows})`(표본<3이고 불참<2면
    'none' 보류, 아니면 rate로 high(≥2회·rate≥0.4)/medium(≥1회·rate≥0.2)/low 판정+초보용 라벨),
    `entryNoShowRisk(entry,idx)`(팀 소속 선수 중 최악 위험 대표, Map/object 둘 다 허용),
    `recommendWaitlist(entries,idx)`(유효 신청의 Σrate(0.9 클램프)로 기대 불참 팀 수→예비팀 크기
    역산+위험 신청 목록+헤드라인, 철회·거절·팀 미확정 제외), `NOSHOW_STYLE`/`worseNoShow`.
    EntryManagement 배선: load()에서 podium 집계 뒤 신청자 과거 전 신청을 조회(id·player1/2)→그
    entry id들로 tournament_matches를 150개씩 청크(URL 길이 방어·최대 600 id)로 배치 조회
    (completed/forfeited만)→buildNoShowIndex로 `noshowIdx` 저장, 전체 try-catch로 감싸 테이블/RLS/
    네트워크 실패 시 예측 없이 그대로 진행(비파괴 degrade). 활성 종목 기준 `recommendWaitlist`
    useMemo로 "불참 예측·예비팀 추천" 패널(위험 높음/불참 이력/예비팀 권장 3카드+헤드라인, 위험
    신청 있을 때만 노출)과 신청 카드 선수 줄의 "불참 위험 높음/불참 이력" 배지(medium/high만),
    위험 신청 카드 앰버 테두리. 승인은 전혀 막지 않는 advisory라 무인 자동 승인율 불변(예측을
    planAutoApprovals에 넣지 않음 — 자동화율을 떨어뜨리지 않기 위한 의도적 설계). tournament_matches
    SELECT는 이미 공개 읽기(LiveScore/Results 동일)라 새 권한·스키마 불필요. 엔진 29개 시나리오
    (표본부족/2회불참 경고·high/medium/low·null 안전·대회단위 중복집계·bye/미완료 제외·tournament_id
    폴백·팀 최악값·Map/object·예비팀 역산·철회 제외·정렬·헤드라인 유무·빈 입력) node 자체 검증 통과,
    `npx vite build` green. (자동화율 주최자 92%→93%)
- 2026-07-11 · C2 · `src/lib/autoDraw.js`(신규)·`src/pages/organizer/BracketGenerator.jsx`(리팩터)·`src/pages/organizer/TournamentManage.jsx`
  · 자동 대진 생성(추첨 무인화) — 주최자 완주 체인(마감·승인·입금·상태전환·시상확정)에서 유일하게
    남아 있던 수작업 "추첨(대진표 생성)"을 채워, 완주를 막던 지점을 제거했다. stateMachine의
    closed→in_progress는 "대진표 존재(matches.length>0)"를 조건으로 걸어, 대회 당일이 와도 주최자가
    BracketGenerator에서 직접 추첨하지 않으면 대회가 시작되지 못하고 blockReason으로 멈춰 있었다(북극성
    DoD가 명시한 "앱이 추첨을 dridve"의 미충족 고리). 공개 추첨 화면에 잠겨 있던 대진 생성 로직을 순수/공용
    엔진으로 승격: `autoDraw.js` 신설 — `uuid`·`knockoutLabel`·`makeMatchRow`·`buildKnockoutRows`(BracketGenerator에서
    이동)·`enrichEntries`(신청행→대진 엔트리 정규화)·`buildDrawPlan`(startDraw의 순수 계획 수립: single_elim
    표준 시드/부전승·pool_only·pool_knockout·round_robin, AI 균형 optimizeDraw 포함, 씨드 고정 반환으로
    재현성 유지)·`persistDrawPlan`(saveSchedule의 DB 저장: 기존 삭제→조·조별참가팀·조별경기·본선 스켈레톤
    삽입)·`autoGenerateBracket`(한 종목: 이미 대진표 있으면 count 체크로 스킵해 절대 덮어쓰지 않음, 승인<2팀
    not_enough, makeSeed→buildDrawPlan→persistDrawPlan)·`autoGenerateAllBrackets`(대회 전 종목 루프,
    created/skipped/notEnough/errors 집계). BracketGenerator는 로컬 글루를 전부 지우고 이 엔진을 import(startDraw→
    buildDrawPlan, saveSchedule→persistDrawPlan, loadEntries→enrichEntries)해 공개 추첨·자동 추첨이 대진 로직
    단일 소스를 공유(중복 0, UI·애니메이션·씨드 공개 검증 불변). TournamentManage 배선: `runAutoDraw`(전 종목
    autoGenerateAllBrackets→성공 시 reloadMatches로 matches 갱신→다음 상태머신 틱이 hasBracket=true로 보고
    기존 무인 전환 useEffect가 closed→in_progress 자동 실행), 무인 ON+status='closed'+plan.blockReason(당일+
    대진표 없음)일 때 autoDrawnRef 1회 잠금으로 자동 실행하는 useEffect, blockReason 배너에 "대진표 자동 생성"
    원터치 버튼(무인 OFF에서도)+결과 안내(생성 N개/승인 부족/오류). categories select를 '*'로 확장(대진에 필요한
    format·pool_size·seeding_enabled 등 컬럼 확보). 스키마·외부 키 불필요(기존 tournament_matches·pools 재사용).
    엔진 23개 시나리오(enrichEntries·single_elim 크기/부전승/시퀀스·pool_only 2조 균형·round_robin·녹아웃 링크/
    부전승 진출·makeMatchRow 기본값) node 자체 검증 통과, `npx vite build` green. 잔여: draft→open만 의도적 수동.
    (자동화율 주최자 89%→92%)
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
- [ ] (품질·선택) `npm test`를 CI에 연결 — 2026-07-11 순수 엔진 회귀 테스트 스위트(`npm test`, 의존성 0)를
      커밋했다. `.github/**`는 에이전트 금지 영역이라 CI 워크플로에 `npm test` 스텝을 넣는 건 사람이 해야 한다
      (넣으면 무인 실행이 엔진을 깨는 PR을 자동 차단). 로컬/빌드 전 수동 실행은 지금 바로 가능.
- [ ] (다음 목표·심판 78%) 무심판 코트 셀프 스코어 — 코트별 심판 모드(`/referee/court/:id`)로 심판 도달 경로는 채웠다(2026-07-10). 남은 건 "심판 없이 선수가 자기 폰으로 점수 입력". 선수가 `/referee/:matchId`를 열어 점수를 쓰려면 `tournament_matches` UPDATE가 필요한데 현재 RLS는 주최자(001 "주최자 관리" FOR ALL)만 허용. 참가 선수도 자기 경기의 live_*·status를 쓰도록 하는 RLS 정책 마이그레이션이 선행돼야 실제 발화 가능(엔진/UI는 그 후 추가). 이 갭이 심판 플로우의 유일한 잔여 공백.
