/**
 * GET /api/events — Paginated event history.
 */

import { db } from "@/db";
import { rawEvents } from "@/db/schema";
import { desc, count } from "drizzle-orm";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get("limit") || "20", 10)));
  const offset = (page - 1) * limit;

  try {
    const database = db();

    const [events, [totalResult]] = await Promise.all([
      database
        .select()
        .from(rawEvents)
        .orderBy(desc(rawEvents.receivedAt))
        .limit(limit)
        .offset(offset),
      database.select({ total: count() }).from(rawEvents),
    ]);

    const total = totalResult.total;

    return Response.json({
      events,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching events:", error);
    return Response.json(
      { error: "Failed to fetch events" },
      { status: 500 },
    );
  }
}
