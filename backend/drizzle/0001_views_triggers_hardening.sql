-- Custom migration: updated_at triggers, summary views, Supabase role hardening.
-- Companion to 0000_init_schema; everything here is either not expressible in
-- the Drizzle schema or deliberately kept as raw SQL.

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;--> statement-breakpoint

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER custom_foods_set_updated_at BEFORE UPDATE ON "custom_foods"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER recipes_set_updated_at BEFORE UPDATE ON "recipes"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER log_entries_set_updated_at BEFORE UPDATE ON "log_entries"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER goals_set_updated_at BEFORE UPDATE ON "goals"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Summary views
-- security_invoker: the view must not become an RLS bypass for non-owner roles;
-- with default-deny RLS only the backend's connection can read through it.
-- ---------------------------------------------------------------------------

-- Per user/day totals over the generated per-entry columns.
CREATE VIEW daily_totals WITH (security_invoker = on) AS
SELECT
  user_id,
  entry_date,
  count(*)::int          AS entry_count,
  sum(kcal)              AS kcal,
  sum(protein_g)         AS protein_g,
  sum(carbs_g)           AS carbs_g,
  sum(fat_g)             AS fat_g
FROM log_entries
GROUP BY user_id, entry_date;--> statement-breakpoint

-- Daily totals joined with the goal that was effective on that day
-- (latest goals row with effective_date <= entry_date).
CREATE VIEW daily_summary WITH (security_invoker = on) AS
SELECT
  d.user_id,
  d.entry_date,
  d.entry_count,
  d.kcal,
  d.protein_g,
  d.carbs_g,
  d.fat_g,
  g.kcal_target,
  g.protein_target_g,
  g.carbs_target_g,
  g.fat_target_g
FROM daily_totals d
LEFT JOIN LATERAL (
  SELECT kcal_target, protein_target_g, carbs_target_g, fat_target_g
  FROM goals g
  WHERE g.user_id = d.user_id AND g.effective_date <= d.entry_date
  ORDER BY g.effective_date DESC
  LIMIT 1
) g ON true;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Supabase role hardening (defense-in-depth on top of default-deny RLS).
-- Only the backend's direct Postgres connection should touch these tables;
-- strip the PostgREST roles entirely. Guarded so the migration also runs on
-- plain Postgres (local dev) where these roles don't exist.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
  END IF;
END $$;
