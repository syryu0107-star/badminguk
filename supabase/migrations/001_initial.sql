-- ============================================================
-- 배드민국 (BadMinGuk) — 초기 스키마
-- Supabase Dashboard > SQL Editor 에서 실행하세요.
-- ============================================================

-- ── 1. 프로필 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL DEFAULT '',
  phone             TEXT,
  official_grade    TEXT NOT NULL DEFAULT '왕초심',
  grade_verified    BOOLEAN NOT NULL DEFAULT false,
  grade_proof_url   TEXT,
  preferred_sports  TEXT[] DEFAULT '{}',
  mmr               INTEGER NOT NULL DEFAULT 1000,
  mmr_games_played  INTEGER NOT NULL DEFAULT 0,
  bio               TEXT,
  avatar_url        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_mmr ON profiles(mmr DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_grade ON profiles(official_grade);

-- 업데이트 시 updated_at 자동 갱신
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. MMR 히스토리 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mmr_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tournament_id  UUID,
  match_id       UUID,
  mmr_before     INTEGER NOT NULL,
  mmr_after      INTEGER NOT NULL,
  delta          INTEGER NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mmr_history_player ON mmr_history(player_id, created_at DESC);

-- ── 3. 대회 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournaments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id       UUID NOT NULL REFERENCES profiles(id),
  title              TEXT NOT NULL,
  venue              TEXT NOT NULL,
  venue_address      TEXT,
  court_count        INTEGER NOT NULL DEFAULT 4,
  date               DATE NOT NULL,
  start_time         TIME NOT NULL DEFAULT '09:00',
  registration_start TIMESTAMPTZ,
  registration_end   TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'draft',
  description        TEXT,
  banner_url         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_tournament_status CHECK (
    status IN ('draft','open','closed','in_progress','completed','cancelled')
  )
);

CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
CREATE INDEX IF NOT EXISTS idx_tournaments_date   ON tournaments(date);
CREATE INDEX IF NOT EXISTS idx_tournaments_org    ON tournaments(organizer_id);

-- ── 4. 종목 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournament_categories (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id       UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  sport_type          TEXT NOT NULL,         -- 남복, 여복, 혼복
  grade_min           TEXT,
  grade_max           TEXT,
  max_teams           INTEGER NOT NULL DEFAULT 32,
  entry_fee           INTEGER NOT NULL DEFAULT 0,
  match_duration_min  INTEGER NOT NULL DEFAULT 30,
  prize_description   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_sport_type CHECK (sport_type IN ('남복','여복','혼복'))
);

-- ── 5. 참가 신청 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournament_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id      UUID NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  team_name        TEXT,
  player1_id       UUID NOT NULL REFERENCES profiles(id),
  player2_id       UUID REFERENCES profiles(id),
  payment_status   TEXT NOT NULL DEFAULT 'pending',
  payment_amount   INTEGER NOT NULL DEFAULT 0,
  entry_status     TEXT NOT NULL DEFAULT 'applied',
  waitlist_position INTEGER,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_entry_status CHECK (
    entry_status IN ('applied','approved','rejected','withdrawn','waitlisted')
  ),
  CONSTRAINT chk_payment_status CHECK (
    payment_status IN ('pending','confirmed','refunded')
  ),
  CONSTRAINT no_self_pair CHECK (player1_id != player2_id)
);

CREATE INDEX IF NOT EXISTS idx_entries_cat ON tournament_entries(category_id);
CREATE INDEX IF NOT EXISTS idx_entries_p1  ON tournament_entries(player1_id);
CREATE INDEX IF NOT EXISTS idx_entries_p2  ON tournament_entries(player2_id);
-- 중복 신청 방지
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_unique
  ON tournament_entries(category_id, player1_id) WHERE entry_status != 'withdrawn';

-- ── 6. 경기 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournament_matches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id      UUID NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  round_type       TEXT NOT NULL DEFAULT 'group',
  match_number     INTEGER,
  team1_entry_id   UUID REFERENCES tournament_entries(id),
  team2_entry_id   UUID REFERENCES tournament_entries(id),
  court_number     INTEGER,
  scheduled_time   TIMESTAMPTZ,
  actual_start     TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'scheduled',
  winner_entry_id  UUID REFERENCES tournament_entries(id),
  forfeit_team     INTEGER,
  forfeit_reason   TEXT,
  mmr_applied      BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_match_status CHECK (
    status IN ('scheduled','in_progress','completed','forfeited','bye')
  )
);

CREATE INDEX IF NOT EXISTS idx_matches_cat  ON tournament_matches(category_id);
CREATE INDEX IF NOT EXISTS idx_matches_time ON tournament_matches(scheduled_time);

-- ── 7. 스코어 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_scores (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id     UUID NOT NULL REFERENCES tournament_matches(id) ON DELETE CASCADE,
  set_number   INTEGER NOT NULL,
  team1_score  INTEGER NOT NULL DEFAULT 0,
  team2_score  INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT positive_scores CHECK (team1_score >= 0 AND team2_score >= 0),
  UNIQUE (match_id, set_number)
);

-- ── RLS 정책 ─────────────────────────────────────────────────
ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE mmr_history        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_scores       ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "누구나 읽기"        ON profiles FOR SELECT USING (true);
CREATE POLICY "본인만 수정"        ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "본인만 삽입"        ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- mmr_history
CREATE POLICY "누구나 읽기"        ON mmr_history FOR SELECT USING (true);
CREATE POLICY "인증된 사용자 삽입"  ON mmr_history FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- tournaments
CREATE POLICY "누구나 읽기"        ON tournaments FOR SELECT USING (true);
CREATE POLICY "주최자 삽입"        ON tournaments FOR INSERT WITH CHECK (auth.uid() = organizer_id);
CREATE POLICY "주최자 수정"        ON tournaments FOR UPDATE USING (auth.uid() = organizer_id);
CREATE POLICY "주최자 삭제"        ON tournaments FOR DELETE USING (auth.uid() = organizer_id);

-- tournament_categories
CREATE POLICY "누구나 읽기"        ON tournament_categories FOR SELECT USING (true);
CREATE POLICY "주최자 관리"        ON tournament_categories FOR ALL
  USING (auth.uid() = (SELECT organizer_id FROM tournaments WHERE id = tournament_id));

-- tournament_entries
CREATE POLICY "누구나 읽기"        ON tournament_entries FOR SELECT USING (true);
CREATE POLICY "신청자 삽입"        ON tournament_entries FOR INSERT WITH CHECK (auth.uid() = player1_id);
CREATE POLICY "본인/주최자 수정"   ON tournament_entries FOR UPDATE
  USING (
    auth.uid() = player1_id OR
    auth.uid() = (
      SELECT t.organizer_id FROM tournaments t
      JOIN tournament_categories tc ON tc.tournament_id = t.id
      WHERE tc.id = category_id
    )
  );

-- tournament_matches
CREATE POLICY "누구나 읽기"        ON tournament_matches FOR SELECT USING (true);
CREATE POLICY "주최자 관리"        ON tournament_matches FOR ALL
  USING (auth.uid() = (
    SELECT t.organizer_id FROM tournaments t
    JOIN tournament_categories tc ON tc.tournament_id = t.id
    WHERE tc.id = category_id
  ));

-- match_scores
CREATE POLICY "누구나 읽기"        ON match_scores FOR SELECT USING (true);
CREATE POLICY "인증된 사용자 관리"  ON match_scores FOR ALL USING (auth.uid() IS NOT NULL);

-- ── Storage 버킷 ──────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public) VALUES ('proofs', 'proofs', true)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "누구나 읽기" ON storage.objects FOR SELECT
  USING (bucket_id = 'proofs');
CREATE POLICY "인증된 업로드" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'proofs' AND auth.uid() IS NOT NULL);
