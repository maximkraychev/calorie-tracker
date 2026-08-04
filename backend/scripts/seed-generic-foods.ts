/**
 * Load `seed/generic-foods.ndjson` into the `generic_foods` table.
 *
 *   npm run seed:apply              # upsert every row
 *   npm run seed:apply -- --dry-run # parse, validate and report; touch nothing
 *
 * Idempotent: rows are upserted on `(source, external_id)`, the unique index the table
 * was designed around, so re-running after a new USDA release updates in place rather
 * than duplicating. Safe to run against a populated database.
 *
 * Batched because the target is Supabase's free tier: 5,044 single INSERTs over the
 * pooler is thousands of round trips, most of them latency. One statement per 250 rows
 * turns that into ~20.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';

import { db } from '../src/db/client.js';
import { genericFoods, type GenericFoodPortion } from '../src/db/schema.js';

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEED_FILE = 'seed/generic-foods.ndjson';

/**
 * Rows per statement. 250 × ~15 columns is ~3,750 bind parameters, comfortably under
 * Postgres's 65,535 limit while keeping the round trips to ~20. Raising it trades
 * shrinking latency gains for a longer single transaction on a 0.1-CPU instance.
 */
const BATCH_SIZE = 250;

interface SeedRow {
  source: string;
  externalId: string;
  name: string;
  nameBg: string | null;
  searchText: string;
  category: string | null;
  kcalPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  servingSizeG: number | null;
  portions: GenericFoodPortion[];
  rank: number;
}

/**
 * Re-check every row against the table's CHECK constraints before sending anything.
 *
 * The importer already enforces these, but a batch INSERT is all-or-nothing: one bad row
 * aborts 250 good ones and the error names a constraint, not a food. Failing here instead
 * reports which row and why, and costs a few milliseconds.
 */
function validate(row: SeedRow, line: number): string | null {
  const bad = (reason: string) => `line ${line} (${row.externalId} "${row.name}"): ${reason}`;

  if (!row.source || !row.externalId) return bad('missing source/externalId');
  if (!row.name?.trim()) return bad('blank name');
  if (!row.searchText?.trim()) return bad('blank searchText');
  if (!(row.kcalPer100g >= 0 && row.kcalPer100g <= 900)) return bad(`kcal ${row.kcalPer100g}`);

  for (const key of ['proteinPer100g', 'carbsPer100g', 'fatPer100g'] as const) {
    const value = row[key];
    if (!(value >= 0 && value <= 100)) return bad(`${key} ${value}`);
  }

  if (row.servingSizeG !== null && !(row.servingSizeG > 0)) {
    return bad(`servingSizeG ${row.servingSizeG}`);
  }
  return null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const path = resolve(BACKEND_ROOT, SEED_FILE);

  const text = await readFile(path, 'utf8');
  const lines = text.split('\n').filter((line) => line.trim().length > 0);

  const rows: SeedRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const [index, line] of lines.entries()) {
    let row: SeedRow;
    try {
      row = JSON.parse(line) as SeedRow;
    } catch {
      errors.push(`line ${index + 1}: not valid JSON`);
      continue;
    }

    const problem = validate(row, index + 1);
    if (problem) {
      errors.push(problem);
      continue;
    }

    // A duplicate key would make the upsert hit the same row twice in one statement,
    // which Postgres rejects outright ("cannot affect row a second time").
    const key = `${row.source}|${row.externalId}`;
    if (seen.has(key)) {
      errors.push(`line ${index + 1}: duplicate (source, external_id) ${key}`);
      continue;
    }
    seen.add(key);
    rows.push(row);
  }

  console.log(`Read ${lines.length} lines from ${SEED_FILE} → ${rows.length} valid rows`);
  const withBg = rows.filter((row) => row.nameBg !== null).length;
  console.log(`  with a Bulgarian name: ${withBg} (${((withBg / rows.length) * 100).toFixed(1)}%)`);

  if (errors.length > 0) {
    console.error(`\n${errors.length} row(s) rejected — fix the seed file and re-run:`);
    errors.slice(0, 20).forEach((problem) => console.error(`  ${problem}`));
    if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
    process.exit(1);
  }

  if (dryRun) {
    console.log('\n--dry-run: database not touched.');
    return;
  }

  // numeric columns take strings: postgres.js round-trips `numeric` as text to avoid the
  // precision loss a float64 would introduce, and Drizzle's numeric type follows suit.
  const values = rows.map((row) => ({
    source: row.source,
    externalId: row.externalId,
    name: row.name,
    nameBg: row.nameBg,
    searchText: row.searchText,
    category: row.category,
    kcalPer100g: String(row.kcalPer100g),
    proteinPer100g: String(row.proteinPer100g),
    carbsPer100g: String(row.carbsPer100g),
    fatPer100g: String(row.fatPer100g),
    servingSizeG: row.servingSizeG === null ? null : String(row.servingSizeG),
    portions: row.portions,
    rank: row.rank,
  }));

  const started = Date.now();
  let written = 0;

  for (let offset = 0; offset < values.length; offset += BATCH_SIZE) {
    const batch = values.slice(offset, offset + BATCH_SIZE);

    await db
      .insert(genericFoods)
      .values(batch)
      .onConflictDoUpdate({
        target: [genericFoods.source, genericFoods.externalId],
        // `id` and `created_at` are deliberately absent: re-importing must not change a
        // row's identity, because log entries reference these foods by external_id and a
        // future `generic_food_id` FK would break. `updated_at` is moved by the trigger.
        set: {
          name: sql`excluded.name`,
          nameBg: sql`excluded.name_bg`,
          searchText: sql`excluded.search_text`,
          category: sql`excluded.category`,
          kcalPer100g: sql`excluded.kcal_per_100g`,
          proteinPer100g: sql`excluded.protein_per_100g`,
          carbsPer100g: sql`excluded.carbs_per_100g`,
          fatPer100g: sql`excluded.fat_per_100g`,
          servingSizeG: sql`excluded.serving_size_g`,
          portions: sql`excluded.portions`,
          rank: sql`excluded.rank`,
        },
      });

    written += batch.length;
    process.stdout.write(`\r  upserted ${written} / ${values.length}`);
  }

  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(genericFoods);

  console.log(
    `\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s.` +
      ` generic_foods now holds ${count?.total ?? '?'} rows.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
