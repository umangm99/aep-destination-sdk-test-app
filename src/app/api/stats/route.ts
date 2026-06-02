/**
 * GET /api/stats — Dashboard statistics.
 */

import { db } from "@/db";
import { rawEvents, profiles, segments, profileSegments } from "@/db/schema";
import { count, gt, eq, and } from "drizzle-orm";
import { isLDEnabled } from "@/lib/launchdarkly";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const database = db();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [
      [totalEvents],
      [totalProfiles],
      [totalSegments],
      [recentEvents],
      [ldForwardedEvents],
      [authenticatedProfiles],
      [realizedMemberships],
      [exitedMemberships],
    ] = await Promise.all([
      database.select({ total: count() }).from(rawEvents),
      database.select({ total: count() }).from(profiles),
      database.select({ total: count() }).from(segments),
      database
        .select({ total: count() })
        .from(rawEvents)
        .where(gt(rawEvents.receivedAt, oneHourAgo)),
      database
        .select({ total: count() })
        .from(rawEvents)
        .where(eq(rawEvents.ldForwarded, true)),
      database
        .select({ total: count() })
        .from(profiles)
        .where(eq(profiles.isAuthenticated, true)),
      database
        .select({ total: count() })
        .from(profileSegments)
        .where(
          and(
            eq(profileSegments.status, "realized"),
          ),
        ),
      database
        .select({ total: count() })
        .from(profileSegments)
        .where(eq(profileSegments.status, "exited")),
    ]);

    return Response.json({
      totalEvents: totalEvents.total,
      totalProfiles: totalProfiles.total,
      totalSegments: totalSegments.total,
      eventsLastHour: recentEvents.total,
      ldForwardedEvents: ldForwardedEvents.total,
      ldEnabled: await isLDEnabled(),
      authenticatedProfiles: authenticatedProfiles.total,
      unauthenticatedProfiles: totalProfiles.total - authenticatedProfiles.total,
      realizedMemberships: realizedMemberships.total,
      exitedMemberships: exitedMemberships.total,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return Response.json(
      { error: "Failed to fetch stats" },
      { status: 500 },
    );
  }
}
