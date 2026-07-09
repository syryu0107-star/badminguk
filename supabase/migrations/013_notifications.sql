-- 013_notifications.sql — 경기 호출·알림 지속 레이어 (C1)
-- 왜 필요한가: 인앱 실시간 방송(broadcast)은 즉시 도달하지만 휘발성이라
--   앱을 닫은 선수는 호출을 놓친다. 이 테이블은 (1) 호출 이력/감사 로그,
--   (2) 방송을 놓친 선수의 미확인 호출 복구(fetchRecentCalls),
--   (3) 웹푸시/알림톡/SMS 외부 발송 큐의 근거가 된다.
-- 미적용 상태에서도 앱은 깨지지 않는다(엔진이 try/catch 로 degrade).
-- 적용: supabase db push 또는 SQL 편집기에서 아래 실행.

create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid references public.profiles(id) on delete cascade,
  tournament_id uuid references public.tournaments(id) on delete cascade,
  match_id      uuid,
  type          text not null,               -- match_call|match_soon|schedule_shift|walkover_warn|result
  title         text not null,
  body          text,
  payload       jsonb default '{}'::jsonb,
  channels      text[] default array['in_app']::text[],
  status        text not null default 'queued', -- queued|sent|read|failed
  read_at       timestamptz,
  created_at    timestamptz default now()
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_tournament_idx
  on public.notifications (tournament_id);

alter table public.notifications enable row level security;

-- 본인 알림만 조회
drop policy if exists "own notifications read" on public.notifications;
create policy "own notifications read" on public.notifications
  for select using (auth.uid() = recipient_id);

-- 인증 사용자(주최자/운영자)가 호출 알림 삽입. 발신 권한 세부검증은 앱단에서.
drop policy if exists "authenticated insert notifications" on public.notifications;
create policy "authenticated insert notifications" on public.notifications
  for insert with check (auth.uid() is not null);

-- 본인 알림 읽음 처리
drop policy if exists "own notifications update" on public.notifications;
create policy "own notifications update" on public.notifications
  for update using (auth.uid() = recipient_id);
