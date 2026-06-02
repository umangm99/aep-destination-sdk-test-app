/**
 * GET /api/profiles/[id] — Single profile detail with segment memberships.
 */

import { db } from "@/db";
import { profiles, profileSegments, segments, identityMapping } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const profileId = Number.parseInt(id, 10);

  if (Number.isNaN(profileId)) {
    return Response.json({ error: "Invalid profile ID" }, { status: 400 });
  }

  try {
    const database = db();

    // Get profile
    const [profile] = await database
      .select()
      .from(profiles)
      .where(eq(profiles.id, profileId))
      .limit(1);

    if (!profile) {
      return Response.json({ error: "Profile not found" }, { status: 404 });
    }

    // Get segment memberships
    const memberships = await database
      .select({
        segmentId: segments.segmentId,
        segmentName: segments.segmentName,
        status: profileSegments.status,
        lastQualificationTime: profileSegments.lastQualificationTime,
        updatedAt: profileSegments.updatedAt,
        ldSynced: segments.ldSynced,
      })
      .from(profileSegments)
      .innerJoin(segments, eq(profileSegments.segmentId, segments.id))
      .where(eq(profileSegments.profileId, profileId));

    // Get identity mapping if authenticated
    let mapping = null;
    if (profile.cifhash) {
      const [m] = await database
        .select()
        .from(identityMapping)
        .where(eq(identityMapping.cifhash, profile.cifhash))
        .limit(1);
      mapping = m || null;
    }

    return Response.json({
      profile,
      segments: memberships,
      identityMapping: mapping,
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    return Response.json(
      { error: "Failed to fetch profile" },
      { status: 500 },
    );
  }
}
