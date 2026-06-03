/**
 * GET /api/segments/[id] — Segment detail with member profiles.
 */

import { db } from "@/db";
import { segments, profileSegments, profiles } from "@/db/schema";
import { eq, and, count, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const segmentDbId = Number.parseInt(id, 10);

  if (Number.isNaN(segmentDbId)) {
    return Response.json({ error: "Invalid segment ID" }, { status: 400 });
  }

  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get("limit") || "20", 10)));
  const offset = (page - 1) * limit;

  try {
    const database = db();

    // Get segment
    const [segment] = await database
      .select()
      .from(segments)
      .where(eq(segments.id, segmentDbId))
      .limit(1);

    if (!segment) {
      return Response.json({ error: "Segment not found" }, { status: 404 });
    }

    // Get member profiles with pagination
    const [members, [totalResult], [authCount], [unauthCount]] =
      await Promise.all([
        database
          .select({
            profileId: profiles.id,
            nbid: profiles.nbid,
            cifhash: profiles.cifhash,
            cif: profiles.cif,
            webTrackerId: profiles.webTrackerId,
            isAuthenticated: profiles.isAuthenticated,
            status: profileSegments.status,
            lastQualificationTime: profileSegments.lastQualificationTime,
            updatedAt: profileSegments.updatedAt,
          })
          .from(profileSegments)
          .innerJoin(profiles, eq(profileSegments.profileId, profiles.id))
          .where(eq(profileSegments.segmentId, segmentDbId))
          .limit(limit)
          .offset(offset),
        database
          .select({ total: count() })
          .from(profileSegments)
          .where(eq(profileSegments.segmentId, segmentDbId)),
        database
          .select({ count: count() })
          .from(profileSegments)
          .innerJoin(profiles, eq(profileSegments.profileId, profiles.id))
          .where(
            and(
              eq(profileSegments.segmentId, segmentDbId),
              eq(profiles.isAuthenticated, true),
            ),
          ),
        database
          .select({ count: count() })
          .from(profileSegments)
          .innerJoin(profiles, eq(profileSegments.profileId, profiles.id))
          .where(
            and(
              eq(profileSegments.segmentId, segmentDbId),
              eq(profiles.isAuthenticated, false),
            ),
          ),
      ]);

    return Response.json({
      segment,
      members,
      stats: {
        authenticated: authCount.count,
        unauthenticated: unauthCount.count,
      },
      pagination: {
        page,
        limit,
        total: totalResult.total,
        totalPages: Math.ceil(totalResult.total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching segment detail:", error);
    return Response.json(
      { error: "Failed to fetch segment" },
      { status: 500 },
    );
  }
}
