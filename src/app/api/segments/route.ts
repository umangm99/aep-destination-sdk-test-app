/**
 * GET /api/segments — List all segments with member counts and LD sync status.
 */

import { db } from "@/db";
import { segments } from "@/db/schema";
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

    const [segmentList, [totalResult]] = await Promise.all([
      database
        .select()
        .from(segments)
        .orderBy(desc(segments.firstSeenAt))
        .limit(limit)
        .offset(offset),
      database.select({ total: count() }).from(segments),
    ]);

    return Response.json({
      segments: segmentList,
      pagination: {
        page,
        limit,
        total: totalResult.total,
        totalPages: Math.ceil(totalResult.total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching segments:", error);
    return Response.json(
      { error: "Failed to fetch segments" },
      { status: 500 },
    );
  }
}
