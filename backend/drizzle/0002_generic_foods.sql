ALTER TYPE "public"."food_source" ADD VALUE 'generic';--> statement-breakpoint
CREATE TABLE "generic_foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'usda' NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"name_bg" text,
	"search_text" text NOT NULL,
	"category" text,
	"kcal_per_100g" numeric(7, 2) NOT NULL,
	"protein_per_100g" numeric(6, 2) NOT NULL,
	"carbs_per_100g" numeric(6, 2) NOT NULL,
	"fat_per_100g" numeric(6, 2) NOT NULL,
	"serving_size_g" numeric(7, 2),
	"portions" jsonb,
	"rank" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generic_foods_name_not_blank" CHECK (length(trim("generic_foods"."name")) > 0),
	CONSTRAINT "generic_foods_search_text_not_blank" CHECK (length(trim("generic_foods"."search_text")) > 0),
	CONSTRAINT "generic_foods_serving_size_positive" CHECK ("generic_foods"."serving_size_g" IS NULL OR "generic_foods"."serving_size_g" > 0),
	CONSTRAINT "generic_foods_kcal_per_100g_range" CHECK ("generic_foods"."kcal_per_100g" >= 0 AND "generic_foods"."kcal_per_100g" <= 900),
	CONSTRAINT "generic_foods_macros_per_100g_range" CHECK ("generic_foods"."protein_per_100g" >= 0 AND "generic_foods"."protein_per_100g" <= 100
        AND "generic_foods"."carbs_per_100g" >= 0 AND "generic_foods"."carbs_per_100g" <= 100
        AND "generic_foods"."fat_per_100g" >= 0 AND "generic_foods"."fat_per_100g" <= 100)
);
--> statement-breakpoint
ALTER TABLE "generic_foods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "generic_foods_source_external_id_idx" ON "generic_foods" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "generic_foods_search_text_trgm_idx" ON "generic_foods" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Hand-written additions, following migration 0001's conventions. Drizzle-kit
-- does not model triggers or role grants, so a new table needs both restated.
-- ---------------------------------------------------------------------------

-- Same updated_at maintenance every other mutable table gets (0001).
CREATE TRIGGER generic_foods_set_updated_at BEFORE UPDATE ON "generic_foods"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- 0001's REVOKE only covered the tables that existed then; ALTER DEFAULT
-- PRIVILEGES does not retroactively cover a table created by a different role
-- than the one it was set for. Restate it for this table so the PostgREST roles
-- cannot read generic_foods even though its contents are public-domain data —
-- the Data API surface stays uniformly closed rather than selectively open.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "generic_foods" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "generic_foods" FROM authenticated;
  END IF;
END $$;