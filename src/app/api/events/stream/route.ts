/**
 * GET /api/events/stream — Polling endpoint for live event feed.
 * Returns events received after the ?since= timestamp.
 */

import { db } from "@/db";
import { rawEvents } from "@/db/schema";
import { desc, gt } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { maybeCleanup } from "@/lib/cleanup";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const since = searchParams.get("since");

  // Trigger lazy cleanup
  maybeCleanup().catch(() => {});

  try {
    const database = db();

    const sinceDate = since ? new Date(since) : null;
    const isValidDate = sinceDate && !Number.isNaN(sinceDate.getTime());

    const events = await database
      .select()
      .from(rawEvents)
      .where(isValidDate ? gt(rawEvents.receivedAt, sinceDate) : undefined)
      .orderBy(desc(rawEvents.receivedAt))
      .limit(50);

    return Response.json({
      events,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching event stream:", error);
    return Response.json(
      { error: "Failed to fetch events" },
      { status: 500 },
    );
  }
}
