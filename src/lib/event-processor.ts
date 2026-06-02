/**
 * Event processor — business logic for processing incoming AEP payloads.
 * Parses profiles, upserts identities, and manages segment memberships.
 */

import { db } from "@/db";
import {
  rawEvents,
  profiles,
  identityMapping,
  segments,
  profileSegments,
} from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { forwardToLaunchDarkly, isLDEnabled } from "./launchdarkly";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AEPPayload {
  profiles: AEPProfile[];
}

export interface AEPProfile {
  identities: Record<string, string[]>;
  segments: Record<
    string,
    { status: string; lastQualificationTime?: string }
  >;
}



// ─── Profile Resolution ─────────────────────────────────────────────────────

/**
 * Extract identity values from AEP identity map.
 * AEP sends identities as arrays — we take the first value for unique IDs, and all values for ECID.
 */
function extractIdentities(identities: Record<string, string[]>) {
  const getFirst = (key: string): string | null => {
    const entry = Object.entries(identities).find(
      ([k]) => k.toLowerCase() === key.toLowerCase(),
    );
    return entry?.[1]?.[0] || null;
  };
  
  const getAll = (key: string): string[] => {
    const entry = Object.entries(identities).find(
      ([k]) => k.toLowerCase() === key.toLowerCase(),
    );
    return entry?.[1] || [];
  };

  return {
    nbid: getFirst("NBID"),
    cifhash: getFirst("CIFHash"),
    cif: getFirst("CIF"),
    webTrackerId: getFirst("WebTrackerID"),
    ecids: getAll("ECID"),
  };
}

/**
 * Helper to merge incoming ECIDs with existing ECIDs cleanly.
 */
function mergeEcids(existing: string[] | null | undefined, incoming: string[]): string[] {
  return Array.from(new Set([...(existing || []), ...incoming]));
}

/**
 * Resolve or create a profile based on identity hierarchy:
 * 1. If nbid → match on nbid
 * 2. If cifhash → look up nbid from identity_mapping, match on nbid
 * 3. If webTrackerId → match on webTrackerId
 * 4. Else → create new profile with ecid stored for reference
 */
async function resolveProfile(
  identities: ReturnType<typeof extractIdentities>,
  rawIdentitiesJson: Record<string, string[]>,
): Promise<number> {
  const database = db();
  const now = new Date();

  // 1. Try to match by NBID (primary for authenticated)
  if (identities.nbid) {
    const existing = await database
      .select({ id: profiles.id, ecids: profiles.ecids })
      .from(profiles)
      .where(eq(profiles.nbid, identities.nbid))
      .limit(1);

    if (existing.length > 0) {
      // Update existing profile
      await database
        .update(profiles)
        .set({
          cifhash: identities.cifhash || undefined,
          cif: identities.cif || undefined,
          webTrackerId: identities.webTrackerId || undefined,
          ecids: mergeEcids(existing[0].ecids, identities.ecids),
          isAuthenticated: true,
          rawIdentities: rawIdentitiesJson,
          lastSeenAt: now,
        })
        .where(eq(profiles.id, existing[0].id));

      return existing[0].id;
    }

    // Create new authenticated profile
    const [newProfile] = await database
      .insert(profiles)
      .values({
        nbid: identities.nbid,
        cifhash: identities.cifhash,
        cif: identities.cif,
        webTrackerId: identities.webTrackerId,
        ecids: identities.ecids,
        isAuthenticated: true,
        rawIdentities: rawIdentitiesJson,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning({ id: profiles.id });

    // Also create identity mapping if we have all three
    if (identities.cifhash && identities.cif) {
      await database
        .insert(identityMapping)
        .values({
          nbid: identities.nbid,
          cifhash: identities.cifhash,
          cif: identities.cif,
        })
        .onConflictDoNothing();
    }

    return newProfile.id;
  }

  // 2. Try to resolve via CIFHash → identity_mapping → NBID
  if (identities.cifhash) {
    const mapping = await database
      .select()
      .from(identityMapping)
      .where(eq(identityMapping.cifhash, identities.cifhash))
      .limit(1);

    if (mapping.length > 0) {
      // Found mapping, look up profile by NBID
      const existing = await database
        .select({ id: profiles.id, ecids: profiles.ecids })
        .from(profiles)
        .where(eq(profiles.nbid, mapping[0].nbid))
        .limit(1);

      if (existing.length > 0) {
        await database
          .update(profiles)
          .set({
            webTrackerId: identities.webTrackerId || undefined,
            ecids: mergeEcids(existing[0].ecids, identities.ecids),
            rawIdentities: rawIdentitiesJson,
            lastSeenAt: now,
          })
          .where(eq(profiles.id, existing[0].id));

        return existing[0].id;
      }
    }

    // No mapping found — try matching by cifhash directly on profile
    const existing = await database
      .select({ id: profiles.id, ecids: profiles.ecids })
      .from(profiles)
      .where(eq(profiles.cifhash, identities.cifhash))
      .limit(1);

    if (existing.length > 0) {
      await database
        .update(profiles)
        .set({
          cif: identities.cif || undefined,
          webTrackerId: identities.webTrackerId || undefined,
          ecids: mergeEcids(existing[0].ecids, identities.ecids),
          rawIdentities: rawIdentitiesJson,
          lastSeenAt: now,
        })
        .where(eq(profiles.id, existing[0].id));

      return existing[0].id;
    }

    // Create new profile with cifhash (partially authenticated)
    const [newProfile] = await database
      .insert(profiles)
      .values({
        cifhash: identities.cifhash,
        cif: identities.cif,
        webTrackerId: identities.webTrackerId,
        ecids: identities.ecids,
        isAuthenticated: true,
        rawIdentities: rawIdentitiesJson,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning({ id: profiles.id });

    return newProfile.id;
  }

  // 3. Try to match by WebTrackerID (unique per customer)
  if (identities.webTrackerId) {
    const existing = await database
      .select({ id: profiles.id, ecids: profiles.ecids })
      .from(profiles)
      .where(eq(profiles.webTrackerId, identities.webTrackerId))
      .limit(1);

    if (existing.length > 0) {
      await database
        .update(profiles)
        .set({
          ecids: mergeEcids(existing[0].ecids, identities.ecids),
          rawIdentities: rawIdentitiesJson,
          lastSeenAt: now,
        })
        .where(eq(profiles.id, existing[0].id));

      return existing[0].id;
    }

    // Create new unauthenticated profile
    const [newProfile] = await database
      .insert(profiles)
      .values({
        webTrackerId: identities.webTrackerId,
        ecids: identities.ecids,
        isAuthenticated: false,
        rawIdentities: rawIdentitiesJson,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning({ id: profiles.id });

    return newProfile.id;
  }

  // 4. ECID only — cannot reliably match (shared browser), create new profile
  const [newProfile] = await database
    .insert(profiles)
    .values({
      ecids: identities.ecids,
      isAuthenticated: false,
      rawIdentities: rawIdentitiesJson,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .returning({ id: profiles.id });

  return newProfile.id;
}

// ─── Segment Processing ─────────────────────────────────────────────────────

/**
 * Upsert a segment and return its DB ID.
 */
async function upsertSegment(
  segmentId: string,
  segmentName?: string,
): Promise<number> {
  const database = db();

  const existing = await database
    .select({ id: segments.id })
    .from(segments)
    .where(eq(segments.segmentId, segmentId))
    .limit(1);

  if (existing.length > 0) {
    if (segmentName) {
      await database
        .update(segments)
        .set({ segmentName })
        .where(eq(segments.id, existing[0].id));
    }
    return existing[0].id;
  }

  const [newSegment] = await database
    .insert(segments)
    .values({
      segmentId,
      segmentName,
      ldSegmentKey: segmentId.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase(),
    })
    .returning({ id: segments.id });

  return newSegment.id;
}

/**
 * Upsert profile-segment membership.
 */
async function upsertProfileSegment(
  profileId: number,
  segmentDbId: number,
  status: string,
  lastQualificationTime?: string,
) {
  const database = db();

  await database
    .insert(profileSegments)
    .values({
      profileId,
      segmentId: segmentDbId,
      status,
      lastQualificationTime,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [profileSegments.profileId, profileSegments.segmentId],
      set: {
        status,
        lastQualificationTime,
        updatedAt: new Date(),
      },
    });
}

/**
 * Update segment profile counts.
 */
async function updateSegmentCounts() {
  const database = db();

  await database.execute(sql`
    UPDATE segments SET profile_count = (
      SELECT COUNT(*) FROM profile_segments ps
      WHERE ps.segment_id = segments.id
      AND ps.status IN ('realized', 'existing')
    )
  `);
}

// ─── Main Processor ──────────────────────────────────────────────────────────

/**
 * Process an incoming AEP event payload.
 * 1. Store raw event
 * 2. Resolve/create profiles
 * 3. Upsert segments and memberships
 * 4. Forward to LaunchDarkly (if enabled)
 */
export interface LDForwardingTask {
  eventId: number;
  entries: Array<{
    profile: { nbid: string | null; webTrackerId: string | null; ecids: string[] };
    segmentChanges: Array<{
      segmentId: string;
      segmentName?: string;
      status: string;
    }>;
  }>;
}

export interface ProcessingResult {
  eventId: number;
  profilesProcessed: number;
  segmentsProcessed: number;
  ldTask: LDForwardingTask | null; // Passed to background worker
}

// ─── Main Processor ──────────────────────────────────────────────────────────

/**
 * Process an incoming AEP event payload (Synchronous part).
 * 1. Store raw event
 * 2. Resolve/create profiles
 * 3. Upsert segments and memberships
 * 4. Return data needed for LD forwarding
 */
export async function processAEPEvent(
  payload: AEPPayload,
  sourceIp?: string,
): Promise<ProcessingResult> {
  const database = db();
  const ldEnabled = await isLDEnabled();

  // 1. Store raw event
  const [rawEvent] = await database
    .insert(rawEvents)
    .values({
      payload: payload as unknown as Record<string, unknown>,
      profilesCount: payload.profiles?.length || 0,
      sourceIp,
    })
    .returning({ id: rawEvents.id });

  let profilesProcessed = 0;
  let segmentsProcessed = 0;
  
  const ldEntries: LDForwardingTask["entries"] = [];

  // 2. Process each profile
  for (const aepProfile of payload.profiles || []) {
    const identities = extractIdentities(aepProfile.identities || {});
    const profileId = await resolveProfile(identities, aepProfile.identities || {});
    profilesProcessed++;

    // 3. Process segment memberships
    const segmentChanges: Array<{
      segmentId: string;
      segmentName?: string;
      status: string;
    }> = [];

    for (const [segId, segData] of Object.entries(aepProfile.segments || {})) {
      const segmentDbId = await upsertSegment(segId);
      await upsertProfileSegment(
        profileId,
        segmentDbId,
        segData.status,
        segData.lastQualificationTime,
      );
      segmentsProcessed++;

      segmentChanges.push({
        segmentId: segId,
        status: segData.status,
      });
    }

    if (ldEnabled && segmentChanges.length > 0) {
      ldEntries.push({
        profile: {
          nbid: identities.nbid,
          webTrackerId: identities.webTrackerId,
          ecids: identities.ecids,
        },
        segmentChanges,
      });
    }
  }

  // Update segment counts
  await updateSegmentCounts();

  return {
    eventId: rawEvent.id,
    profilesProcessed,
    segmentsProcessed,
    ldTask: ldEnabled && ldEntries.length > 0 ? { eventId: rawEvent.id, entries: ldEntries } : null,
  };
}

/**
 * Executes the LaunchDarkly forwarding in the background.
 * Run this using Next.js after() to prevent blocking the response.
 */
export async function executeBackgroundLDForwarding(task: LDForwardingTask) {
  const database = db();
  let totalForwarded = 0;
  let totalFailed = 0;

  for (const entry of task.entries) {
    const result = await forwardToLaunchDarkly(entry.profile, entry.segmentChanges);
    totalForwarded += result.forwarded;
    totalFailed += result.failed;
  }

  // Mark event as LD forwarded if successful
  if (totalForwarded > 0) {
    await database
      .update(rawEvents)
      .set({ ldForwarded: true })
      .where(eq(rawEvents.id, task.eventId));
  }
  
  console.log(`Background LD sync complete. Forwarded: ${totalForwarded}, Failed: ${totalFailed}`);
}
