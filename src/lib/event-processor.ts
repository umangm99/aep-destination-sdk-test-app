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
import { eq, sql, inArray } from "drizzle-orm";
import { batchForwardToLD, isLDEnabled } from "./launchdarkly";

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
  


  return {
    cifhash: getFirst("CIFHash"),
    webTrackerId: getFirst("WebTrackerID"),
  };
}

/**
 * Resolve or create a profile based on identity hierarchy:
 * 1. If nbid → match on nbid
 * 2. If cifhash → look up nbid from identity_mapping, match on nbid
 * 4. Else → create new profile and insert into mapping
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
          webTrackerId: identities.webTrackerId || undefined,
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
        webTrackerId: identities.webTrackerId || undefined,
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
): Promise<{ id: number; ldSynced: boolean; segmentName: string | null }> {
  const database = db();

  const existing = await database
    .select({ id: segments.id, ldSynced: segments.ldSynced, segmentName: segments.segmentName })
    .from(segments)
    .where(eq(segments.segmentId, segmentId))
    .limit(1);

  if (existing.length > 0) {
    if (segmentName) {
      await database
        .update(segments)
        .set({ segmentName })
        .where(eq(segments.id, existing[0].id));
      return { id: existing[0].id, ldSynced: existing[0].ldSynced, segmentName };
    }
    return { id: existing[0].id, ldSynced: existing[0].ldSynced, segmentName: existing[0].segmentName };
  }

  const [newSegment] = await database
    .insert(segments)
    .values({
      segmentId,
      segmentName,
      ldSegmentKey: segmentId.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase(),
    })
    .returning({ id: segments.id, ldSynced: segments.ldSynced, segmentName: segments.segmentName });

  return { id: newSegment.id, ldSynced: newSegment.ldSynced, segmentName: newSegment.segmentName };
}

/**
 * Update the ldSynced flag for a segment.
 */
async function updateLDSynced(segmentId: string, synced: boolean): Promise<void> {
  const database = db();
  await database
    .update(segments)
    .set({ ldSynced: synced })
    .where(eq(segments.segmentId, segmentId));
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
      ldSynced: boolean;
    }>;
  }>;
}

export interface ProcessingResult {
  eventId: number;
  profilesProcessed: number;
  segmentsProcessed: number;
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

  // 2. Process each profile
  for (const aepProfile of payload.profiles || []) {
    const identities = extractIdentities(aepProfile.identities || {});
    const profileId = await resolveProfile(identities, aepProfile.identities || {});
    profilesProcessed++;

    // 3. Process segment memberships
    for (const [segId, segData] of Object.entries(aepProfile.segments || {})) {
      const segmentDb = await upsertSegment(segId);
      const wasApplied = await upsertProfileSegment(
        profileId,
        segmentDb.id,
        segData.status,
        segData.lastQualificationTime,
      );
      segmentsProcessed++;

      if (!wasApplied) {
        console.warn(
          `Skipped stale segment update: profile=${profileId} segment=${segId} ` +
          `status=${segData.status} time=${segData.lastQualificationTime}`
        );
      }
    }
  }

  // Update segment counts
  await updateSegmentCounts();

  return {
    eventId: rawEvent.id,
    profilesProcessed,
    segmentsProcessed,
  };
}

/**
 * Process pending LD events from the rawEvents table.
 * To be called by a cron job periodically.
 */
export async function processPendingLDEvents(limit = 50) {
  const database = db();
  const ldEnabled = await isLDEnabled();
  if (!ldEnabled) return { processed: 0, errors: 0 };

  // Fetch pending events
  const pendingEvents = await database
    .select()
    .from(rawEvents)
    .where(eq(rawEvents.ldForwarded, false))
    .orderBy(rawEvents.receivedAt)
    .limit(limit);

  if (pendingEvents.length > 0) {
    console.log(`[Event Processor] Found ${pendingEvents.length} pending events. Starting processing...`);
  } else {
    console.log(`[Event Processor] No pending events to process.`);
    return { processed: 0, errors: 0 };
  }

  let processedCount = 0;
  let errorCount = 0;

  const allLDEntries: LDForwardingTask["entries"] = [];
  const eventsWithLDEntries: number[] = [];

  // --- 1. Pre-Scan and Gather Unique Keys ---
  const allCifHashes = new Set<string>();
  const allWebTrackerIds = new Set<string>();
  const allSegmentIds = new Set<string>();

  for (const event of pendingEvents) {
    const payload = event.payload as unknown as AEPPayload;
    for (const aepProfile of payload.profiles || []) {
      const identities = extractIdentities(aepProfile.identities || {});
      if (identities.cifhash) allCifHashes.add(identities.cifhash);
      if (identities.webTrackerId) allWebTrackerIds.add(identities.webTrackerId);
      for (const segId of Object.keys(aepProfile.segments || {})) {
        allSegmentIds.add(segId);
      }
    }
  }

  // --- 2. Bulk Fetch from DB into In-Memory Maps ---
  const identityMap = new Map<string, string>(); // cifhash -> nbid
  if (allCifHashes.size > 0) {
    const mappings = await database
      .select({ cifhash: identityMapping.cifhash, nbid: identityMapping.nbid })
      .from(identityMapping)
      .where(inArray(identityMapping.cifhash, Array.from(allCifHashes)));
    for (const m of mappings) if (m.nbid) identityMap.set(m.cifhash, m.nbid);
  }

  const profileMapByNbid = new Map<string, { nbid: string | null; webTrackerId: string | null }>();
  const profileMapByWeb = new Map<string, { nbid: string | null; webTrackerId: string | null }>();
  
  const allNbids = new Set<string>(Array.from(identityMap.values()));
  if (allNbids.size > 0) {
    const pNbid = await database
      .select({ nbid: profiles.nbid, webTrackerId: profiles.webTrackerId })
      .from(profiles)
      .where(inArray(profiles.nbid, Array.from(allNbids)));
    for (const p of pNbid) if (p.nbid) profileMapByNbid.set(p.nbid, p);
  }
  
  if (allWebTrackerIds.size > 0) {
    const pWeb = await database
      .select({ nbid: profiles.nbid, webTrackerId: profiles.webTrackerId })
      .from(profiles)
      .where(inArray(profiles.webTrackerId, Array.from(allWebTrackerIds)));
    for (const p of pWeb) if (p.webTrackerId) profileMapByWeb.set(p.webTrackerId, p);
  }

  const segmentMap = new Map<string, { ldSynced: boolean; segmentName: string | null }>();
  if (allSegmentIds.size > 0) {
    const segDb = await database
      .select({ segmentId: segments.segmentId, ldSynced: segments.ldSynced, segmentName: segments.segmentName })
      .from(segments)
      .where(inArray(segments.segmentId, Array.from(allSegmentIds)));
    for (const s of segDb) segmentMap.set(s.segmentId, s);
  }

  // --- 3. Process Events using In-Memory Maps ---
  for (const event of pendingEvents) {
    try {
      const payload = event.payload as unknown as AEPPayload;
      const eventLDEntries: LDForwardingTask["entries"] = [];

      for (const aepProfile of payload.profiles || []) {
        const identities = extractIdentities(aepProfile.identities || {});
        let resolvedProfile: { nbid: string | null; webTrackerId: string | null } | null = null;

        // In-memory lookup: cifhash -> nbid -> profile
        if (identities.cifhash) {
          const nbid = identityMap.get(identities.cifhash);
          if (nbid) {
            resolvedProfile = profileMapByNbid.get(nbid) || null;
          }
        }

        // In-memory lookup: webTrackerId -> profile
        if (!resolvedProfile && identities.webTrackerId) {
          resolvedProfile = profileMapByWeb.get(identities.webTrackerId) || null;
        }

        if (!resolvedProfile) {
          // If profile wasn't found, skip LD forwarding for it
          continue;
        }

        const segmentChanges: Array<{
          segmentId: string;
          segmentName?: string;
          status: string;
          ldSynced: boolean;
        }> = [];

        for (const [segId, segData] of Object.entries(aepProfile.segments || {})) {
          // In-memory lookup: segmentId -> segment stats
          const segInfo = segmentMap.get(segId);
          if (!segInfo) continue;

          segmentChanges.push({
            segmentId: segId,
            segmentName: segInfo.segmentName || undefined,
            status: segData.status,
            ldSynced: segInfo.ldSynced,
          });
        }

        if (segmentChanges.length > 0) {
          eventLDEntries.push({
            profile: {
              nbid: resolvedProfile.nbid,
              webTrackerId: resolvedProfile.webTrackerId,
            },
            segmentChanges,
          });
        }
      }

      if (eventLDEntries.length > 0) {
        allLDEntries.push(...eventLDEntries);
        eventsWithLDEntries.push(event.id);
      } else {
        // Nothing to forward, mark as done immediately
        await database
          .update(rawEvents)
          .set({ ldForwarded: true })
          .where(eq(rawEvents.id, event.id));
        processedCount++;
        console.log(`[Event Processor] Event ${event.id}: No valid segment changes to sync. Marked as forwarded.`);
      }

    } catch (err) {
      console.error(`Error processing pending event ${event.id}:`, err);
      errorCount++;
    }
  }

  // Now forward ALL collected entries in a single batch operation
  if (allLDEntries.length > 0) {
    console.log(`[Event Processor] Forwarding ${allLDEntries.length} LD entries across ${eventsWithLDEntries.length} events...`);
    const { totalFailed } = await batchForwardToLD(allLDEntries);
    
    if (totalFailed === 0) {
      // Mark all successful events as forwarded
      await database
        .update(rawEvents)
        .set({ ldForwarded: true })
        .where(inArray(rawEvents.id, eventsWithLDEntries));
      processedCount += eventsWithLDEntries.length;
      console.log(`[Event Processor] Successfully synced and marked ${eventsWithLDEntries.length} events as forwarded.`);
    } else {
      // If there are failures, we leave them in the queue to be retried
      errorCount += eventsWithLDEntries.length;
      console.error(`[Event Processor] Failed to sync some segments to LD. Leaving ${eventsWithLDEntries.length} events in queue for retry.`);
    }
  }

  return { processed: processedCount, errors: errorCount };
}

/**
 * Process Audience Metadata from AEP.
 * @param audiences - Array of audience objects with id and name.
 * @param action - "create" | "update" | "delete" — determines what we do in DB and LD.
 */
export async function processAepMetadata(
  segmentsList: Array<{ id: string; name: string; description?: string }>,
  action: "create" | "update" | "delete" = "create",
): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;
  const database = db();
  const ldEnabled = await isLDEnabled();

  const { updateLDSegmentName, deleteLDSegment, createLDSegment } = await import("./launchdarkly");

  for (const aud of segmentsList) {
    if (!aud.id) {
      errors++;
      continue;
    }

    try {
      const segmentKey = aud.id.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();

      if (action === "delete") {
        // Remove from LaunchDarkly first
        if (ldEnabled) {
          const deleted = await deleteLDSegment(segmentKey);
          if (deleted) {
            // Remove segment from DB only if LD deletion was successful
            await database
              .delete(segments)
              .where(eq(segments.segmentId, aud.id));
            console.log(`Deleted segment ${aud.id} from DB and LD`);
          } else {
            console.warn(`Skipped DB deletion for segment ${aud.id} due to LD deletion failure.`);
            errors++;
          }
        } else {
          // If LD is disabled, just delete from DB
          await database
            .delete(segments)
            .where(eq(segments.segmentId, aud.id));
          console.log(`Deleted segment ${aud.id} from DB`);
        }
      } else if (action === "create") {
        // "create" — safely create/upsert in DB
        await upsertSegment(aud.id, aud.name);

        if (ldEnabled) {
          const success = await createLDSegment(segmentKey, aud.name, aud.description);
          if (success) {
            await updateLDSynced(aud.id, true);
          }
        }
      } else if (action === "update") {
        // "update" — safely update/upsert in DB
        await upsertSegment(aud.id, aud.name);

        if (ldEnabled) {
          const success = await updateLDSegmentName(segmentKey, aud.name, aud.description);
          if (success) {
            await updateLDSynced(aud.id, true);
          }
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
