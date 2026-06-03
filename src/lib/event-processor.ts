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
    cifhash: getFirst("CIFHash"),
    webTrackerId: getFirst("WebTrackerID"),
  };
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

  // 1. Try to resolve via CIFHash → identity_mapping → NBID
  if (identities.cifhash) {
    const mapping = await database
      .select()
      .from(identityMapping)
      .where(eq(identityMapping.cifhash, identities.cifhash))
      .limit(1);

    if (mapping.length > 0) {
      // Found mapping, look up profile by NBID
      const existing = await database
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.nbid, mapping[0].nbid))
        .limit(1);

      if (existing.length > 0) {
        await database
          .update(profiles)
          .set({
            webTrackerId: identities.webTrackerId || undefined,
            rawIdentities: rawIdentitiesJson,
            lastSeenAt: now,
          })
          .where(eq(profiles.id, existing[0].id));

        return existing[0].id;
      }
    }

    // No mapping found — generate mock identities for this CIFHash
    const generateDigits = (len: number) => {
      let result = "";
      for (let i = 0; i < len; i++) {
        result += Math.floor(Math.random() * 10).toString();
      }
      return result;
    };
    
    const mockNbid = generateDigits(6);
    const mockCif = generateDigits(7);
    const mockWebTrackerId = generateDigits(9);

    await database.insert(identityMapping).values({
      cifhash: identities.cifhash,
      nbid: mockNbid,
      cif: mockCif,
    });

    const existing = await database
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.cifhash, identities.cifhash))
      .limit(1);

    if (existing.length > 0) {
      await database
        .update(profiles)
        .set({
          nbid: mockNbid,
          cif: mockCif,
          webTrackerId: identities.webTrackerId || mockWebTrackerId,
          rawIdentities: rawIdentitiesJson,
          lastSeenAt: now,
        })
        .where(eq(profiles.id, existing[0].id));

      return existing[0].id;
    }

    // Create new profile with the mocked identities
    const [newProfile] = await database
      .insert(profiles)
      .values({
        nbid: mockNbid,
        cifhash: identities.cifhash,
        cif: mockCif,
        webTrackerId: identities.webTrackerId || mockWebTrackerId,
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
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.webTrackerId, identities.webTrackerId))
      .limit(1);

    if (existing.length > 0) {
      await database
        .update(profiles)
        .set({
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
        isAuthenticated: false,
        rawIdentities: rawIdentitiesJson,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning({ id: profiles.id });

    return newProfile.id;
  }

  throw new Error("No valid identities provided by AEP");
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
 * Uses lastQualificationTime to enforce event ordering:
 * - New rows are always inserted.
 * - Existing rows are only updated if the incoming lastQualificationTime
 *   is newer than (or equal to) what's already stored, preventing
 *   out-of-order events from overwriting newer state.
 *
 * Returns true if the row was inserted or updated, false if skipped (stale).
 */
async function upsertProfileSegment(
  profileId: number,
  segmentDbId: number,
  status: string,
  lastQualificationTime?: string,
): Promise<boolean> {
  const database = db();

  // Use raw SQL to conditionally update only if incoming timestamp is >= stored.
  // The onConflictDoUpdate SET clause with a WHERE ensures stale events are dropped.
  const result = await database
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
      setWhere: lastQualificationTime
        ? sql`${profileSegments.lastQualificationTime} IS NULL OR ${profileSegments.lastQualificationTime} <= ${lastQualificationTime}`
        : undefined,
    });

  // If rowCount is 0, the conflict update was skipped (stale event)
  const rowCount = (result as unknown as { rowCount: number }).rowCount ?? 1;
  return rowCount > 0;
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
    profile: { nbid: string | null; webTrackerId: string | null; };
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

    // Fetch resolved profile to ensure we pass the canonical NBID to LaunchDarkly
    const [resolvedProfile] = await database
      .select({ nbid: profiles.nbid, webTrackerId: profiles.webTrackerId })
      .from(profiles)
      .where(eq(profiles.id, profileId))
      .limit(1);

    // 3. Process segment memberships
    const segmentChanges: Array<{
      segmentId: string;
      segmentName?: string;
      status: string;
    }> = [];

    for (const [segId, segData] of Object.entries(aepProfile.segments || {})) {
      const segmentDbId = await upsertSegment(segId);
      const wasApplied = await upsertProfileSegment(
        profileId,
        segmentDbId,
        segData.status,
        segData.lastQualificationTime,
      );
      segmentsProcessed++;

      // Only forward to LD if this was actually a newer event (not stale)
      if (wasApplied) {
        segmentChanges.push({
          segmentId: segId,
          status: segData.status,
        });
      } else {
        console.warn(
          `Skipped stale segment update: profile=${profileId} segment=${segId} ` +
          `status=${segData.status} time=${segData.lastQualificationTime}`
        );
      }
    }

    if (ldEnabled && segmentChanges.length > 0) {
      ldEntries.push({
        profile: {
          nbid: resolvedProfile.nbid,
          webTrackerId: resolvedProfile.webTrackerId,
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

/**
 * Process Audience Metadata from AEP.
 * @param audiences - Array of audience objects with id and name.
 * @param action - "create" | "update" | "delete" — determines what we do in DB and LD.
 */
export async function processAepMetadata(
  audiences: Array<{ id: string; name: string }>,
  action: "create" | "update" | "delete" = "create",
): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;
  const database = db();
  const ldEnabled = await isLDEnabled();

  const { updateLDSegmentName, deleteLDSegment } = await import("./launchdarkly");

  for (const aud of audiences) {
    if (!aud.id) {
      errors++;
      continue;
    }

    try {
      const segmentKey = aud.id.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();

      if (action === "delete") {
        // Remove segment from DB (profile_segments cascade-deletes automatically)
        await database
          .delete(segments)
          .where(eq(segments.segmentId, aud.id));

        // Remove from LaunchDarkly
        if (ldEnabled) {
          await deleteLDSegment(segmentKey);
        }

        console.log(`Deleted segment ${aud.id} from DB and LD`);
      } else {
        // "create" or "update" — upsert the segment name
        await upsertSegment(aud.id, aud.name);

        if (ldEnabled) {
          await updateLDSegmentName(segmentKey, aud.name);
        }
      }

      processed++;
    } catch (err) {
      console.error(`Error processing metadata (${action}) for segment ${aud.id}:`, err);
      errors++;
    }
  }

  return { processed, errors };
}
