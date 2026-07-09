# 배드민국 완주 흐름 감사 결과

> 4개 여정 감사에서 나온 20개 항목을 통합·정렬한 실행 계획. 테스트용 더미 항목("a/b/c") 1건은 폐기했고, 실제 결함은 **13개 그룹**으로 통합했다(원본 19건 중 중복 6건 병합). 경로는 모두 `C:\Users\PC_1M\Desktop\badminguk` 기준.

---

## 완주를 막는 치명적 구멍 TOP 5

| # | 구멍 | 무엇이 끊기나 | 심각도 |
|---|------|--------------|--------|
| 1 | **MMR이 profiles에 영구 반영 안 됨** (RLS 차단 + 주 채점경로 미호출) | 대회를 다 치러도 MMR 1000·경기수 0 고정 → 랭킹 페이지 영구 "데이터 없음". **플랫폼의 존재 이유가 죽어 있음** | 완주불가 |
| 2 | **유료 대회 결제·입금 기능 전무** | 참가비 낼 방법이 화면에 없음. 유료 대회는 신청은 되지만 여정 완주 자체가 불가 | 완주불가 |
| 3 | **복식 파트너 초대→수락 플로우 부재** | 모든 종목이 복식인데 팀 구성이 반쪽으로 접수됨. 파트너는 묶인 줄도 모르고, 동명이인이면 조용히 NULL | 심각 |
| 4 | **tournament_matches RLS가 주최자 전용** | 별도 심판 계정으로 확정 시 status/승자진출이 조용히 실패 → 브래킷 정지 | 심각 |
| 5 | **불균형 풀에서 본선 스켈레톤 잔존** | 소규모 대회에서 팀 미배정 경기가 영구히 남아 "대회 종료" 차단 → 실질 완주불가 | 보통(실질 완주불가) |

### 정직한 판정: 이 5개를 다 고치면 완주 가능한가?

**조건부 예. 그러나 "5개만"으로는 부족하다.**

- **핵심(#1)은 반드시 SECURITY DEFINER RPC로 재설계**해야 한다. 지금 구조(주최자 브라우저가 남의 profiles를 직접 update)는 RLS와 근본 충돌이라 클라이언트 코드 패치로는 절대 안 고쳐진다. 이걸 RPC 한 곳(`completeMatch` 뒤)으로 통합하면 #1의 두 갈래(RLS 차단 + 심판경로 미호출)가 동시에 해소된다.
- **#4(심판 RLS)는 "주최자 단일 계정 운영"을 공식 전제로 삼으면 우회 가능**하다(현재 window.open 방식). 별도 심판 기기를 쓸 거면 필수. **제품이 어느 쪽인지부터 결정**해야 한다 — 결정 없이는 이 항목이 계속 유령처럼 재발한다.
- **#5(스켈레톤 불균형)는 "보통"으로 분류됐지만 실제로는 소규모 대회 완주를 영구 차단**한다. TOP 5에 넣은 이유다. 배드민턴 동호회 대회는 조가 작은 경우가 흔해 실전에서 자주 터진다.
- **단식 MMR(S3)까지 안 고치면 "완주"는 반쪽**이다. 단식 대회는 아무리 치러도 랭킹 단식 탭이 영영 빈다.

**결론:** TOP 5 + 단식 MMR(S3)까지 = **6개를 고쳐야 "복식·단식 무료 대회를 실제로 완주하고 랭킹까지 살아나는"** 최소선에 도달한다. 유료 대회까지 포함하려면 #2가 필수. 보안 구멍(match_scores/mmr_history 조작)은 완주는 막지 않지만 **순위·시상 위조로 직결**되므로 MMR을 살리는 순간 함께 닫아야 의미가 있다.

---

## 통합·정렬된 수정 계획

### 🔴 완주불가

#### C1. MMR이 profiles에 영구 반영되지 않음 *(원본 gap: profiles RLS 차단 + 심판 점수판 미호출 병합)*
- **증상:** 대회를 정상 종료해도 선수 MMR이 1000에서 안 변하고 경기수 0 유지. 랭킹은 `.gt(games,0)` 필터 때문에 항상 "랭킹 데이터가 없습니다".
- **근본원인:** (a) MMR을 쓰는 유일 코드 `applyMMR`(LiveDashboard.jsx:227-255)이 주최자 세션에서 선수 profiles를 직접 update하는데, `profiles` RLS가 "본인만 수정 `auth.uid()=id`"(001:167)라 주최자≠선수 → 0행 갱신. `.select()`가 없어 error=null이라 **무성공(silent no-op)**. (b) 실제 주 채점 경로인 심판 점수판 `Scoreboard.finalize`(310-347)는 `completeMatch`만 부르고 MMR 계산 코드가 **아예 없음** → 이 경로로 끝낸 경기는 `mmr_applied`조차 false.
- **수정방향:** `apply_match_mmr(match_id)` **SECURITY DEFINER RPC 신설** — 서버측에서 주최자 권한 검증 후 4명 profiles + mmr_history를 **원자적으로** 갱신. 호출 지점을 `advance.js#completeMatch`(공용 진입점) 내부/직후 한 곳으로 통합 → 심판 점수판·주최자 인라인 어느 경로든 동일 반영. walkover 제외/retired 포함 계약도 이 한 곳에서 처리.
- **예상 규모:** **대** (아키텍처 전환)
- **마이그레이션:** **필요** (RPC 함수 + mmr_applied 갱신 경로)

#### C2. 유료 대회 결제·입금 기능 전무
- **증상:** 종목 카드에 "30,000원"만 표시. 계좌 안내·입금 확인·결제 수단이 화면 어디에도 없음. 선수는 입금 방법도, 확인 여부도 모름.
- **근본원인:** 스키마에 `payment_status`(pending/confirmed/refunded)·`payment_amount` 컬럼은 **이미 존재**(001:98-99)하나, `submitEntry`(TournamentDetail.jsx:100-105)가 이를 세팅 안 해 기본값(amount=0, status=pending)으로만 저장. organizer의 EntryManagement.jsx에도 입금 처리 코드 **0건**.
- **수정방향:** 신청 시 `payment_amount=cat.entry_fee` 기록 → 입금 안내(계좌/가상계좌/PG) 화면 + 선수용 입금상태 표시 추가 → 주최자 화면에 `payment_status`를 confirmed로 바꾸는 입금확인 액션. 유료 대회는 입금확인 전까지 승인 보류로 연결.
- **예상 규모:** **대** (신규 화면 + 주최자 액션, PG 연동 시 특히)
- **마이그레이션:** **불필요** (컬럼은 이미 있음. 단, 입금확인 액션의 RLS는 주최자 범위여야 함)

---

### 🟠 심각

#### S1. 복식 파트너 초대→수락 플로우 부재 *(원본 3건 병합: 절차 부재 + 이름조회 .single() + 동의/중복)*
- **증상:** 모든 종목이 복식(남복/여복/혼복)인데 파트너 초대·수락 절차가 없음. 파트너 칸이 자유 텍스트라 비운 채 신청해도 반쪽 팀으로 접수. 동명이인/오타/미가입이면 조용히 player2=NULL. 지정당한 파트너는 묶인 줄 모르고, 같은 종목에 자기를 또 신청해 **같은 두 사람이 서로 다른 두 팀으로 중복 등록** 가능.
- **근본원인:** (a) `submitEntry`가 partner를 선택값 취급, `partner.trim()` 비면 player2_id=null로 insert(TournamentDetail.jsx:93-105). 수락 대기를 담을 `entry_status` 값('partner_pending') 부재(001:104-106). (b) 파트너를 name `ilike` 후 `.single()` — 0건/2건이면 pm=null → `p2id=pm?.id=undefined` → supabase-js가 undefined 키를 누락시켜 **조용히 NULL insert**(TournamentDetail.jsx:94-105). (c) myEntries가 `.eq('player1_id')`만 조회(71)라 파트너에겐 "신청 완료"가 안 보임. 유니크 인덱스가 `(category_id, player1_id)`에만 걸려(001:117-118) 양방향 중복 통과. insert RLS는 player1_id=auth.uid()만 허용(001:187)이라 파트너는 거절 권한도 없음.
- **수정방향:** 파트너를 **전화번호/사용자 검색 후 프로필 id로 선택**(자유 텍스트 폐기). "초대→상대가 자기 앱에서 수락" 2단계 도입, `entry_status`에 'partner_pending' 추가해 수락 시 'applied' 전환. 파트너 미지정 시 신청 버튼 비활성화. myEntries를 `or(player1_id, player2_id)`로 변경(Profile.jsx:72 방식). 파트너에게 거절 권한(UPDATE RLS 확장). 조회 0건/복수면 명시적 에러.
- **예상 규모:** **대** (신규 초대/알림 UX + 스키마 + RLS)
- **마이그레이션:** **필요** (entry_status 값 추가, 양방향 중복 방지 제약, 파트너 UPDATE RLS)

#### S2. tournament_matches RLS 주최자 전용 → 별도 심판 채점·진출 실패 *(원본 2건 병합)*
- **증상:** 주최자가 아닌 심판 계정으로 점수판을 쓰면 경기 시작·라이브 갱신·최종 확정이 모두 조용히 실패. finalize는 catch돼 "결과 저장 실패" alert만 뜨고 승자가 진출 안 됨(브래킷 정지). match_scores insert는 통과해 **점수는 있는데 경기가 안 끝나는** 불일치 발생.
- **근본원인:** `tournament_matches`의 유일 write 정책이 "주최자 관리 FOR ALL USING(auth.uid()=organizer_id)"(001:200-205). 005~008에서 심판용 완화 없음. `startMatch`(179)·`updateLiveCache`(164)·`completeMatch`의 update(advance.js:89,101)가 전부 걸림. RoleLanding에 심판 역할 진입도 없음(선수/주최자만).
- **수정방향:** **제품 결정 먼저** — "주최자 단일 계정 운영"이면 그 제약을 명시 문서화하고 현 window.open 우회 유지. 별도 심판을 쓸 거면 대회별 심판 화이트리스트로 write 정책 확장하거나, **경기 확정을 SECURITY DEFINER RPC로 처리**(C1 RPC와 통합 가능)해 서버측 권한 검증.
- **예상 규모:** **중** (RPC 통합 시 C1과 함께), 단일운영 확정 시 **소**(문서화)
- **마이그레이션:** **필요**(심판 경로 택할 경우) / 불필요(단일운영 확정 시)

#### S3. 단식 MMR 미계산 + singles 컬럼 미기록
- **증상:** 랭킹 '단식' 탭이 항상 비어 있음. 단식 대회를 아무리 치러도 `singles_mmr`/`singles_games_played`가 안 변함.
- **근본원인:** `mmr.js resolveMatchMMR`에 단식 분기 없음. `applyMMR`은 팀이 2명이 아니면 early return(LiveDashboard.jsx:232)이라 1대1을 통째 스킵. 반영돼도 항상 doubles 컬럼(mmr/mmr_games_played)만 쓰고 `singles_mmr`/`singles_games_played`(005)·`mmr_history.game_mode`는 절대 안 씀. 반면 Ranking.jsx는 완성된 단식 탭으로 `singles_mmr`을 읽음(45-46,51).
- **수정방향:** 게임 모드 판별 → 단식이면 1인 Elo로 `singles_*`에, 복식이면 `mmr_*`에 기록하도록 분기. `mmr_history.game_mode` 함께 저장. **C1의 RPC 안에서 처리**하는 게 정석.
- **예상 규모:** **중** (C1 RPC에 얹으면 소~중)
- **마이그레이션:** **불필요** (컬럼 005에 이미 존재, 로직만)

#### S4. match_scores 누구나 조작 가능
- **증상:** 아무 로그인 유저(참가 선수 포함)가 남의 대회 아무 경기 세트 점수를 임의 삽입·수정·삭제 가능.
- **근본원인:** "인증된 사용자 관리 FOR ALL USING(auth.uid() IS NOT NULL)"(001:209) — 인증만 되면 전 대회 match_scores에 ALL 권한. 소유자 제약 전무. `finalizeRanks`가 이 점수로 리그 순위를 계산하므로 **순위·시상 조작 직결**.
- **수정방향:** 정책을 `match→category→tournament.organizer_id = auth.uid()`로 범위 제한(서브쿼리 조인). 또는 점수 쓰기를 SECURITY DEFINER RPC로만 허용하고 직접 write 차단. 읽기는 공개 유지.
- **예상 규모:** **소** (정책 재작성)
- **마이그레이션:** **필요**

---

### 🟡 보통

#### M1. 파트너 자격(급수/MMR) 검증 미적용
- **증상:** 종목이 급수·MMR 상한을 걸어도 검사가 신청자 본인에게만 적용 → 고수 파트너를 끼워 하위 급수 출전(샌드배깅 우회).
- **근본원인:** `checkEligibility`가 본인 profile만 받음(TournamentDetail.jsx:12-31,87). 파트너의 official_grade/mmr는 조회조차 안 함.
- **수정방향:** 파트너 프로필까지 조회해 팀 양쪽에 checkEligibility 적용. 위반 시 사유 명시하고 차단. **S1(파트너를 id로 선택)에 의존** — S1 완료 후 자연스럽게 얹힘.
- **예상 규모:** **소** (S1 선행 시)
- **마이그레이션:** **불필요**

#### M2. 본선 경기 코트·시간 미배정
- **증상:** 조별리그 후 본선 대진이 채워져도 CourtView 어느 코트 카드에도 안 뜨고 예정 시간 없음. 프로젝터상 본선이 "없는 것처럼" 보임.
- **근본원인:** `BracketGenerator.saveSchedule`(348-359)가 본선 스켈레톤을 `scheduleMatches` 없이 만들어 court_number·scheduled_time=null. `seedKnockoutFromPools`(advance.js:221-241)도 팀 id만 채우고 코트/시간 미배정. CourtView는 `court_number===cn` 매칭(451-461)이라 null 경기 누락.
- **수정방향:** `seedKnockoutFromPools`에서 1라운드 팀 배정 직후 빈 코트/시간을 `scheduleMatches`로 할당(또는 완료 경기 코트 재사용). 최소한 CourtView가 코트 미배정 knockout도 표시하도록 보완.
- **예상 규모:** **중**
- **마이그레이션:** **불필요**

#### M3. 불균형 풀 → 본선 스켈레톤 잔존(실질 완주 차단)
- **증상:** 조 팀 수가 진출 인원보다 적은 소규모 대회에서 본선 1라운드 일부 경기가 팀 미배정(scheduled)으로 영구 잔존 → 상위 라운드 영원 대기 → "대회 종료"가 "끝나지 않은 경기 N개"로 막힘.
- **근본원인:** 스켈레톤 크기는 BracketGenerator(349-356)에서 **계획값**(`pools×adv_per_pool + wildcard`)의 nextPow2로 고정 생성. 반면 `seedKnockoutFromPools`는 `determineAdvancements`의 **실제** 진출 수로 다시 계산 → `round1.length < koRound1.length`면 루프(221-241)에서 `b=undefined`인 경기를 continue로 건너뛰어 미충원.
- **수정방향:** 스켈레톤 크기를 계획값이 아닌 **실제 진출 가능 수**(`Σ min(팀수, adv_per_pool) + 실제 wildcard`)로 맞추거나, seed 시 남는 빈 경기를 부전승/삭제 처리. 또는 저장 시점에 실제 수로 스켈레톤 재생성.
- **예상 규모:** **중**
- **마이그레이션:** **불필요**

#### M4. mmr_history 위조 가능
- **증상:** 아무 로그인 유저가 가짜 MMR 이력 행을 삽입 가능 → 프로필 MMR 변동 이력으로 노출.
- **근본원인:** "인증된 사용자 삽입 WITH CHECK(auth.uid() IS NOT NULL)"(001:172) — 소유/일관성 검증 없이 삽입.
- **수정방향:** mmr_history 삽입을 **C1의 SECURITY DEFINER RPC 안에서만** 수행하게 하고 직접 INSERT 정책 제거(또는 player_id 검증 강화).
- **예상 규모:** **소** (C1과 함께)
- **마이그레이션:** **필요**

#### M5. cert_level 기본값 'none' → MMR 불변
- **증상:** C1을 고쳐도 새 대회는 경기를 치러도 MMR이 안 움직임(경기수만 증가).
- **근본원인:** `tournaments.cert_level` 기본 'none'(004:6), `applyMMR`이 `cert_level ?? 'none'` 사용(LiveDashboard.jsx:229), mmr.js에서 'none'은 K=0 → 델타 0(7,51-55). 설계 의도(비공인=친선)지만 UI 설정 부재와 겹쳐 오인.
- **수정방향:** 대회 생성/설정 UI에서 cert_level 명시 선택. 공인 대회일 때만 MMR 반영됨을 결과·순위 화면에 안내.
- **예상 규모:** **소**
- **마이그레이션:** **불필요** (UI 로직)

#### M6. 신청 후 내 신청/입금/승인 상태 통합 뷰 부재
- **증상:** 신청했는지·승인됐는지·돈 냈는지 한눈에 보는 곳이 없음. MyMatches는 브래킷 생성 전까지 "예정 경기 없음"만, payment_status는 어디에도 없음.
- **근본원인:** `submitEntry` 성공 후 myEntries refetch 안 하고 로컬 success만 true(TournamentDetail.jsx:108). MyMatches는 tournament_matches만 조회(26-35). 신청 내역은 Profile 하단(64-74)에 entry_status만, payment_status 미표시(286-296).
- **수정방향:** MyMatches를 "내 신청(입금·승인 상태) + 경기 일정" 통합 화면으로 확장하거나 별도 '내 신청' 탭. Profile 카드에 payment_status·파트너 이름 표시. 신청 성공 시 myEntries 즉시 재조회.
- **예상 규모:** **중**
- **마이그레이션:** **불필요**

---

### ⚪ 경미

#### L1. 심판 점수판 도달 UI 경로 부재
- **증상:** 코트 배치된 심판이 자기 코트 점수판을 스스로 찾아갈 화면이 없음. 주최자가 LiveDashboard에서 새 탭을 열어주거나 URL 수동 공유해야 함.
- **근본원인:** referee 링크 노출이 LiveDashboard(515·537) window.open뿐. CourtView·심판 랜딩 없음.
- **수정방향:** 코트별 심판 접근 목록(코트 선택→현재 경기 점수판) 또는 QR/링크 배포. **S2 심판 역할 정비와 함께 설계**.
- **예상 규모:** **중** (S2에 종속)
- **마이그레이션:** **불필요**

#### L2. 완료 경기 live_* 캐시 미정리
- **증상:** 경기 종료 후에도 `live_score_t1/t2`·`live_game_no`가 마지막 값 그대로 잔존. 현재는 status 게이트로 가려지나 다른 뷰에서 노출 소지.
- **근본원인:** completeMatch/finalize 어디서도 live_* 리셋 안 함(advance.js:89-98은 status/winner만). match_scores와 live_score의 수명주기 어긋남.
- **수정방향:** completeMatch 종료 시 live_score=0, live_server_team=null 등 정리. 또는 완료 경기는 match_scores만 쓰도록 규약 명문화.
- **예상 규모:** **소**
- **마이그레이션:** **불필요**

---

## 마이그레이션이 필요한 스키마 변경 (별도 집약)

새 마이그레이션 파일(예: `supabase/migrations/010_completion_fixes.sql`)로 묶어 처리 권장. **순서 주의** — RPC가 다른 정책의 우회 경로이므로 먼저.

| 순번 | 변경 | 대상 항목 | 비고 |
|------|------|-----------|------|
| 1 | **`apply_match_mmr(match_id)` SECURITY DEFINER 함수 신설** — 주최자 권한 검증 후 profiles(단식/복식 분기) + mmr_history 원자적 갱신, tournament_matches.mmr_applied=true | C1, S3, M4 | 플랫폼 핵심. 이 하나가 여러 구멍을 동시에 닫음 |
| 2 | **`match_scores` RLS 재작성** — `FOR ALL USING(auth.uid() IS NOT NULL)` 폐기 → organizer 범위 서브쿼리 조인(또는 RPC-only write). 읽기 공개 유지 | S4 | |
| 3 | **`mmr_history` RLS 재작성** — 직접 INSERT 정책 제거, RPC(#1) 안에서만 삽입 | M4 | |
| 4 | **`tournament_matches` 확정 경로** — 심판 write 정책 추가(대회별 심판 화이트리스트) **또는** 경기확정 RPC로 처리 | S2 | **제품 결정(단일운영 vs 별도심판) 후 진행.** 단일운영이면 스킵 |
| 5 | **`entry_status`에 'partner_pending' 값 추가** | S1 | enum이면 `ALTER TYPE ... ADD VALUE`(트랜잭션 블록 제약 주의), CHECK 제약이면 제약 재정의. **실제 001 정의를 파일에서 재확인 후 결정** |
| 6 | **파트너 양방향 중복 방지 제약** — 현 유니크 `(category_id, player1_id)`로는 A↔B 이중 신청 통과. player1/player2 정규화 후 팀 단위 유니크 인덱스 | S1 | 정규화 방식(정렬된 페어) 검토 필요 |
| 7 | **파트너 UPDATE RLS 확장** — player2도 자기 참여를 거절/철회 가능하게 | S1 | |

**마이그레이션 불필요(컬럼은 이미 존재, 로직/UI만):**
- `payment_status`/`payment_amount` — 001에 존재(C2)
- `singles_mmr`/`singles_games_played`/`mmr_history.game_mode` — 005에 존재(S3)
- `cert_level` — 004에 존재, UI 설정만(M5)

---

## 권장 실행 순서 (의존성 기준)

1. **마이그레이션 #1 (apply_match_mmr RPC)** → `completeMatch`에서 호출 통합. C1·S3·M4 동시 해소, 랭킹 부활. **최우선.**
2. **마이그레이션 #2, #3 (match_scores·mmr_history RLS 조이기)** → MMR 살아나는 순간 조작 방어 필수(S4·M4).
3. **제품 결정: 단일운영 vs 별도 심판** → 결정에 따라 마이그레이션 #4·L1 진행 여부 확정(S2).
4. **M3 스켈레톤 크기 로직 수정** → 소규모 대회 완주 차단 제거.
5. **S1 파트너 플로우(마이그레이션 #5·#6·#7 + UI)** → 규모 큼. M1·M6가 여기 얹힘.
6. **C2 결제** → 유료 대회 필요 시. 규모 큼, 독립 진행 가능.
7. 나머지 보통·경미(M2·M5·L2).

> 주의: C1과 S2·S4·M4는 **하나의 RPC 설계로 묶어야** 중복 작업·재발이 없다. 개별 클라이언트 패치로 접근하면 RLS와 계속 충돌한다 — 여기가 이 감사의 가장 중요한 교훈이다.