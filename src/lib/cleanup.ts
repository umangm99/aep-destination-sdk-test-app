/**
 * Auto-cleanup utility for raw events.
 * Deletes raw events older than EVENT_RETENTION_DAYS (default 7).
 * Called lazily — at most once per hour.
 */

import { db } from "@/db";
import { rawEvents } from "@/db/schema";
import { lt } from "drizzle-orm";

let lastCleanup = 0;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Run cleanup if enough time has passed since the last run.
 * Returns the number of deleted rows, or -1 if skipped.
 */
export async function maybeCleanup(): Promise<number> {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) {
    return -1; // Skip — too soon
  }

  lastCleanup = now;

  const retentionDays = Number.parseInt(
    process.env.EVENT_RETENTION_DAYS || "7",
    10,
  );
  const cutoff = new Date(now - retentionDays * 24 * 60 * 60 * 1000);

  try {
    const database = db();
    const result = await database
      .delete(rawEvents)
      .where(lt(rawEvents.receivedAt, cutoff))
      .returning({ id: rawEvents.id });

    if (result.length > 0) {
      console.log(`Cleanup: deleted ${result.length} raw events older than ${retentionDays} days`);
    }

    return result.length;
  } catch (error) {
    console.error("Cleanup error:", error);
    return 0;
  }
}
