/**
 * GET /api/profiles — List profiles with identities and segment counts.
 */

import { db } from "@/db";
import { profiles, profileSegments } from "@/db/schema";
import { desc, count, eq, or, ilike, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get("limit") || "20", 10)));
  const search = searchParams.get("search")?.trim();
  const offset = (page - 1) * limit;

  try {
    const database = db();

    // Build where clause for search
    const whereClause = search
      ? or(
          ilike(profiles.nbid, `%${search}%`),
          ilike(profiles.cifhash, `%${search}%`),
          ilike(profiles.cif, `%${search}%`),
          ilike(profiles.webTrackerId, `%${search}%`),
          ilike(profiles.ecid, `%${search}%`),
        )
      : undefined;

    const [profileList, [totalResult]] = await Promise.all([
      database
        .select({
          id: profiles.id,
          nbid: profiles.nbid,
          cifhash: profiles.cifhash,
          cif: profiles.cif,
          webTrackerId: profiles.webTrackerId,
          ecid: profiles.ecid,
          isAuthenticated: profiles.isAuthenticated,
          firstSeenAt: profiles.firstSeenAt,
          lastSeenAt: profiles.lastSeenAt,
          segmentCount: sql<number>`(
            SELECT COUNT(*) FROM profile_segments ps
            WHERE ps.profile_id = ${profiles.id}
            AND ps.status IN ('realized', 'existing')
          )`.as("segment_count"),
        })
        .from(profiles)
        .where(whereClause)
        .orderBy(desc(profiles.lastSeenAt))
        .limit(limit)
        .offset(offset),
      database
        .select({ total: count() })
        .from(profiles)
        .where(whereClause),
    ]);

    return Response.json({
      profiles: profileList,
      pagination: {
        page,
        limit,
        total: totalResult.total,
        totalPages: Math.ceil(totalResult.total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching profiles:", error);
    return Response.json(
      { error: "Failed to fetch profiles" },
      { status: 500 },
    );
  }
}
