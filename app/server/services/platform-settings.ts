import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { platformSettings } from '../db/schema/index.ts';

export async function getSetting(key: string): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, key))
    .limit(1);
  return row ? (row.value as Record<string, unknown>) : null;
}

export async function getAllSettings(): Promise<Map<string, Record<string, unknown>>> {
  const rows = await db.select().from(platformSettings);
  const map = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    map.set(r.key, r.value as Record<string, unknown>);
  }
  return map;
}

export async function upsertSetting(key: string, value: Record<string, unknown>): Promise<void> {
  await db
    .insert(platformSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value, updatedAt: new Date() },
    });
}
