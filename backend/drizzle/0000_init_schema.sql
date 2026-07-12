CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."food_source" AS ENUM('search', 'barcode', 'ai', 'recipe', 'custom', 'manual');--> statement-breakpoint
CREATE TYPE "public"."meal_type" AS ENUM('breakfast', 'lunch', 'dinner', 'snack');--> statement-breakpoint
CREATE TYPE "public"."recipe_nutrition_mode" AS ENUM('ingredients', 'manual');--> statement-breakpoint
CREATE TABLE "custom_foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"kcal_per_100g" numeric(7, 2) NOT NULL,
	"protein_per_100g" numeric(6, 2) NOT NULL,
	"carbs_per_100g" numeric(6, 2) NOT NULL,
	"fat_per_100g" numeric(6, 2) NOT NULL,
	"serving_size_g" numeric(7, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_foods_name_not_blank" CHECK (length(trim("custom_foods"."name")) > 0),
	CONSTRAINT "custom_foods_serving_size_positive" CHECK ("custom_foods"."serving_size_g" IS NULL OR "custom_foods"."serving_size_g" > 0),
	CONSTRAINT "custom_foods_kcal_per_100g_range" CHECK ("custom_foods"."kcal_per_100g" >= 0 AND "custom_foods"."kcal_per_100g" <= 900),
	CONSTRAINT "custom_foods_macros_per_100g_range" CHECK ("custom_foods"."protein_per_100g" >= 0 AND "custom_foods"."protein_per_100g" <= 100
        AND "custom_foods"."carbs_per_100g" >= 0 AND "custom_foods"."carbs_per_100g" <= 100
        AND "custom_foods"."fat_per_100g" >= 0 AND "custom_foods"."fat_per_100g" <= 100)
);
--> statement-breakpoint
ALTER TABLE "custom_foods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"kcal_target" integer NOT NULL,
	"protein_target_g" numeric(6, 2),
	"carbs_target_g" numeric(6, 2),
	"fat_target_g" numeric(6, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_kcal_target_positive" CHECK ("goals"."kcal_target" > 0),
	CONSTRAINT "goals_macro_targets_non_negative" CHECK (("goals"."protein_target_g" IS NULL OR "goals"."protein_target_g" >= 0)
        AND ("goals"."carbs_target_g" IS NULL OR "goals"."carbs_target_g" >= 0)
        AND ("goals"."fat_target_g" IS NULL OR "goals"."fat_target_g" >= 0))
);
--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"meal" "meal_type" NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"source" "food_source" NOT NULL,
	"grams" numeric(7, 2) NOT NULL,
	"kcal_per_100g" numeric(7, 2) NOT NULL,
	"protein_per_100g" numeric(6, 2) NOT NULL,
	"carbs_per_100g" numeric(6, 2) NOT NULL,
	"fat_per_100g" numeric(6, 2) NOT NULL,
	"serving_size_g" numeric(7, 2),
	"custom_food_id" uuid,
	"recipe_id" uuid,
	"external_id" text,
	"kcal" numeric(9, 2) GENERATED ALWAYS AS (round(("grams" * "kcal_per_100g") / 100.0, 2)) STORED,
	"protein_g" numeric(8, 2) GENERATED ALWAYS AS (round(("grams" * "protein_per_100g") / 100.0, 2)) STORED,
	"carbs_g" numeric(8, 2) GENERATED ALWAYS AS (round(("grams" * "carbs_per_100g") / 100.0, 2)) STORED,
	"fat_g" numeric(8, 2) GENERATED ALWAYS AS (round(("grams" * "fat_per_100g") / 100.0, 2)) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "log_entries_grams_positive" CHECK ("log_entries"."grams" > 0),
	CONSTRAINT "log_entries_name_not_blank" CHECK (length(trim("log_entries"."name")) > 0),
	CONSTRAINT "log_entries_serving_size_positive" CHECK ("log_entries"."serving_size_g" IS NULL OR "log_entries"."serving_size_g" > 0),
	CONSTRAINT "log_entries_kcal_per_100g_range" CHECK ("log_entries"."kcal_per_100g" >= 0 AND "log_entries"."kcal_per_100g" <= 900),
	CONSTRAINT "log_entries_macros_per_100g_range" CHECK ("log_entries"."protein_per_100g" >= 0 AND "log_entries"."protein_per_100g" <= 100
        AND "log_entries"."carbs_per_100g" >= 0 AND "log_entries"."carbs_per_100g" <= 100
        AND "log_entries"."fat_per_100g" >= 0 AND "log_entries"."fat_per_100g" <= 100)
);
--> statement-breakpoint
ALTER TABLE "log_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"source" "food_source" NOT NULL,
	"custom_food_id" uuid,
	"external_id" text,
	"grams" numeric(7, 2) NOT NULL,
	"kcal_per_100g" numeric(7, 2) NOT NULL,
	"protein_per_100g" numeric(6, 2) NOT NULL,
	"carbs_per_100g" numeric(6, 2) NOT NULL,
	"fat_per_100g" numeric(6, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_ingredients_grams_positive" CHECK ("recipe_ingredients"."grams" > 0),
	CONSTRAINT "recipe_ingredients_name_not_blank" CHECK (length(trim("recipe_ingredients"."name")) > 0),
	CONSTRAINT "recipe_ingredients_kcal_per_100g_range" CHECK ("recipe_ingredients"."kcal_per_100g" >= 0 AND "recipe_ingredients"."kcal_per_100g" <= 900),
	CONSTRAINT "recipe_ingredients_macros_per_100g_range" CHECK ("recipe_ingredients"."protein_per_100g" >= 0 AND "recipe_ingredients"."protein_per_100g" <= 100
        AND "recipe_ingredients"."carbs_per_100g" >= 0 AND "recipe_ingredients"."carbs_per_100g" <= 100
        AND "recipe_ingredients"."fat_per_100g" >= 0 AND "recipe_ingredients"."fat_per_100g" <= 100)
);
--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"nutrition_mode" "recipe_nutrition_mode" NOT NULL,
	"total_weight_g" numeric(8, 2),
	"kcal_total" numeric(8, 2),
	"protein_total_g" numeric(7, 2),
	"carbs_total_g" numeric(7, 2),
	"fat_total_g" numeric(7, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipes_name_not_blank" CHECK (length(trim("recipes"."name")) > 0),
	CONSTRAINT "recipes_total_weight_positive" CHECK ("recipes"."total_weight_g" IS NULL OR "recipes"."total_weight_g" > 0),
	CONSTRAINT "recipes_mode_shape" CHECK (("recipes"."nutrition_mode" = 'manual'
            AND "recipes"."total_weight_g" IS NOT NULL
            AND "recipes"."kcal_total" IS NOT NULL AND "recipes"."kcal_total" >= 0
            AND "recipes"."protein_total_g" IS NOT NULL AND "recipes"."protein_total_g" >= 0
            AND "recipes"."carbs_total_g" IS NOT NULL AND "recipes"."carbs_total_g" >= 0
            AND "recipes"."fat_total_g" IS NOT NULL AND "recipes"."fat_total_g" >= 0)
        OR ("recipes"."nutrition_mode" = 'ingredients'
            AND "recipes"."kcal_total" IS NULL
            AND "recipes"."protein_total_g" IS NULL
            AND "recipes"."carbs_total_g" IS NULL
            AND "recipes"."fat_total_g" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "recipes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_foods" ADD CONSTRAINT "custom_foods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_custom_food_id_custom_foods_id_fk" FOREIGN KEY ("custom_food_id") REFERENCES "public"."custom_foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_custom_food_id_custom_foods_id_fk" FOREIGN KEY ("custom_food_id") REFERENCES "public"."custom_foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_foods_user_id_idx" ON "custom_foods" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "custom_foods_name_trgm_idx" ON "custom_foods" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "goals_user_effective_date_idx" ON "goals" USING btree ("user_id","effective_date");--> statement-breakpoint
CREATE INDEX "log_entries_user_date_idx" ON "log_entries" USING btree ("user_id","entry_date");--> statement-breakpoint
CREATE INDEX "log_entries_custom_food_id_idx" ON "log_entries" USING btree ("custom_food_id");--> statement-breakpoint
CREATE INDEX "log_entries_recipe_id_idx" ON "log_entries" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_ingredients_recipe_id_idx" ON "recipe_ingredients" USING btree ("recipe_id","position");--> statement-breakpoint
CREATE INDEX "recipe_ingredients_custom_food_id_idx" ON "recipe_ingredients" USING btree ("custom_food_id");--> statement-breakpoint
CREATE INDEX "recipes_user_id_idx" ON "recipes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recipes_name_trgm_idx" ON "recipes" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));