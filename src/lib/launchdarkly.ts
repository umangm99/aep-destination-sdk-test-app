/**
 * LaunchDarkly integration via REST API.
 * Forwards AEP segment membership changes to LD segments.
 *
 * Context key fallback: nbid → webtrackerid
 * CIFHash is NEVER sent to LD — only used for identity_mapping lookups.
 */


import { db } from "@/db";
import { segments } from "@/db/schema";
import { eq } from "drizzle-orm";

interface SegmentChange {
  segmentId: string;
  segmentName?: string;
  status: string; // "realized", "existing", "exited"
  ldSynced: boolean;
}

const verifiedSegmentsCache = new Set<string>();

interface LDConfig {
  apiKey: string;
  projectKey: string;
  environmentKey: string;
}

const LD_API_BASE = "https://app.launchdarkly.com/api/v2";

function getLDConfig(): LDConfig | null {

  const apiKey = process.env.LAUNCHDARKLY_API_KEY;
  const projectKey = process.env.LAUNCHDARKLY_PROJECT_KEY || "default";
  const environmentKey = process.env.LAUNCHDARKLY_ENVIRONMENT_KEY || "production";

  if (!apiKey) {
    console.error("LAUNCHDARKLY_API_KEY not configured but LAUNCHDARKLY_ENABLED=true");
    return null;
  }

  return { apiKey, projectKey, environmentKey };
}

/**
 * Resolve the LD context key for a profile.
 * Fallback chain: nbid → web_tracker_id
 * CIFHash is NOT used as LD key.
 */
export function resolveLDContextKey(profile: {
  nbid?: string | null;
  webTrackerId?: string | null;
}): string | null {
  return profile.nbid || profile.webTrackerId || null;
}

/**
 * Sanitize a string for use as an LD segment key.
 * LD segment keys must be alphanumeric + hyphens + underscores + dots.
 */
function sanitizeSegmentKey(segmentId: string): string {
  return segmentId.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
}

/**
 * Ensure a segment exists in LaunchDarkly. Auto-creates if it doesn't exist.
 * Used during profile event ingestion to handle out-of-order deliveries.
 */
async function ensureLDSegment(
  config: LDConfig,
  segmentKey: string,
  segmentName?: string,
  ldSynced: boolean = false,
): Promise<boolean> {
  if (verifiedSegmentsCache.has(segmentKey)) return true;

  if (ldSynced) {
    verifiedSegmentsCache.add(segmentKey);
    return true;
  }

  // Create the segment if not synced
  const createUrl = `${LD_API_BASE}/segments/${config.projectKey}/${config.environmentKey}`;
  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: config.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key: segmentKey,
      name: segmentName || segmentKey,
      description: `Auto-created from AEP event stream: ${segmentName || segmentKey}`,
      tags: ["aep-sync"],
    }),
  });

  if (createRes.ok || createRes.status === 409) {
    if (createRes.ok) console.log(`Created LD segment: ${segmentKey}`);
    verifiedSegmentsCache.add(segmentKey);

    // Fire-and-forget DB update to permanently mark as synced
    db()
      .update(segments)
      .set({ ldSynced: true })
      .where(eq(segments.ldSegmentKey, segmentKey))
      .execute()
      .catch((err) => console.error(`Failed to update DB ldSynced flag for ${segmentKey}:`, err));

    return true;
  }

  const error = await createRes.text();
  console.error(`Failed to create LD segment ${segmentKey}: ${error}`);
  return false;
}

/**
 * Create a segment in LaunchDarkly.
 * Called when an audience is mapped to the destination in AEP.
 */
export async function createLDSegment(
  segmentKey: string,
  segmentName: string,
  description?: string,
): Promise<boolean> {
  const config = getLDConfig();
  if (!config) return false;

  const createUrl = `${LD_API_BASE}/segments/${config.projectKey}/${config.environmentKey}`;
  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: config.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key: segmentKey,
      name: segmentName || segmentKey,
      description: description ? `${description} (Auto-synced from AEP)` : `Auto-created from AEP segment: ${segmentName || segmentKey}`,
      tags: ["aep-sync"],
    }),
  });

  if (createRes.ok) {
    console.log(`Created LD segment: ${segmentKey}`);
    verifiedSegmentsCache.add(segmentKey);
    return true;
  }

  // Handle existing segment gracefully
  if (createRes.status === 409) {
    console.log(`LD segment ${segmentKey} already exists. Updating name to ensure it is not stuck with a UUID fallback.`);
    verifiedSegmentsCache.add(segmentKey);
    return updateLDSegmentName(segmentKey, segmentName, description);
  }

  const error = await createRes.text();
  console.error(`Failed to create LD segment ${segmentKey}: ${error}`);
  return false;
}



/**
 * Update the name and description of a segment in LaunchDarkly.
 */
export async function updateLDSegmentName(
  segmentKey: string,
  segmentName: string,
  description?: string,
): Promise<boolean> {
  const config = getLDConfig();
  if (!config) return false;

  const url = `${LD_API_BASE}/segments/${config.projectKey}/${config.environmentKey}/${segmentKey}`;

  const descToSet = description ? `${description} (Auto-synced from AEP)` : `Auto-synced from AEP: ${segmentName}`;

  // Use standard JSON Patch to replace name and description
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: config.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      { op: "replace", path: "/name", value: segmentName },
      { op: "replace", path: "/description", value: descToSet },
    ]),
  });

  if (res.ok) {
    console.log(`Updated LD segment name for: ${segmentKey}`);
    return true;
  }

  // If 404, log gracefully
  if (res.status === 404) {
    console.warn(`LD segment ${segmentKey} not found for update. Proceeding gracefully.`);
    return false;
  }

  const error = await res.text();
  console.error(`Failed to update LD segment name ${segmentKey}: ${error}`);
  return false;
}

/**
 * Delete a segment from LaunchDarkly.
 * Called when an audience is unmapped from the destination in AEP.
 */
export async function deleteLDSegment(
  segmentKey: string,
): Promise<boolean> {
  const config = getLDConfig();
  if (!config) return false;

  const url = `${LD_API_BASE}/segments/${config.projectKey}/${config.environmentKey}/${segmentKey}`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: config.apiKey,
    },
  });

  if (res.ok || res.status === 204) {
    console.log(`Deleted LD segment: ${segmentKey}`);
    verifiedSegmentsCache.delete(segmentKey);
    return true;
  }

  if (res.status === 404) {
    console.log(`LD segment ${segmentKey} already deleted or not found.`);
    verifiedSegmentsCache.delete(segmentKey);
    return true; // Already gone, consider success
  }

  const error = await res.text();
  console.error(`Failed to delete LD segment ${segmentKey}: ${error}`);
  return false;
}

/**
 * Batch forward segment changes for multiple profiles to LaunchDarkly.
 * Groups operations by segment to drastically reduce API calls.
 */
export async function batchForwardToLD(
  entries: Array<{
    profile: { nbid?: string | null; webTrackerId?: string | null; };
    segmentChanges: SegmentChange[];
  }>,
): Promise<{ totalForwarded: number; totalFailed: number }> {
  const config = getLDConfig();
  if (!config) return { totalForwarded: 0, totalFailed: 0 };

  let totalForwarded = 0;
  let totalFailed = 0;

  // 1. Group operations by segment
  const segmentMap = new Map<
    string,
    {
      segmentName?: string;
      ldSynced: boolean;
      addKeys: string[];
      removeKeys: string[];
    }
  >();

  for (const entry of entries) {
    const contextKey = resolveLDContextKey(entry.profile);
    if (!contextKey) continue;

    for (const change of entry.segmentChanges) {
      const segmentKey = sanitizeSegmentKey(change.segmentId);
      if (!segmentMap.has(segmentKey)) {
        segmentMap.set(segmentKey, {
          segmentName: change.segmentName,
          ldSynced: change.ldSynced,
          addKeys: [],
          removeKeys: [],
        });
      }

      const mapEntry = segmentMap.get(segmentKey)!;
      // Inherit the true value if any profile in the batch has it cached as true
      if (change.ldSynced) mapEntry.ldSynced = true;
      if (change.segmentName) mapEntry.segmentName = change.segmentName;

      const action = change.status === "realized" || change.status === "existing" ? "add" : "remove";
      if (action === "add") {
        mapEntry.addKeys.push(contextKey);
      } else {
        mapEntry.removeKeys.push(contextKey);
      }
    }
  }

  // 2. Dispatch PATCH requests in chunks to respect rate limits (max 15/sec)
  const segmentEntries = Array.from(segmentMap.entries());
  const chunkSize = 15;
  const results: PromiseSettledResult<{ forwarded: number }>[] = [];

  for (let i = 0; i < segmentEntries.length; i += chunkSize) {
    const chunk = segmentEntries.slice(i, i + chunkSize);
    
    const chunkResults = await Promise.allSettled(
      chunk.map(async ([segmentKey, data]) => {
        // Ensure segment exists
        const exists = await ensureLDSegment(config, segmentKey, data.segmentName, data.ldSynced);
        if (!exists) throw new Error(`Segment ${segmentKey} does not exist and could not be created.`);

        const url = `${LD_API_BASE}/segments/${config.projectKey}/${config.environmentKey}/${segmentKey}`;
        const instructions: any[] = [];

        const uniqueAddKeys = Array.from(new Set(data.addKeys));
        const uniqueRemoveKeys = Array.from(new Set(data.removeKeys));

        if (uniqueAddKeys.length > 0) {
          instructions.push({
            kind: "addIncludedTargets",
            contextKind: "user",
            values: uniqueAddKeys,
          });
        }

        if (uniqueRemoveKeys.length > 0) {
          instructions.push({
            kind: "removeIncludedTargets",
            contextKind: "user",
            values: uniqueRemoveKeys,
          });
        }

        if (instructions.length === 0) return { forwarded: 0 };

        const res = await fetch(url, {
          method: "PATCH",
          headers: {
            Authorization: config.apiKey,
            "Content-Type": "application/json; domain-model=launchdarkly.semanticpatch",
          },
          body: JSON.stringify({
            instructions,
            comment: `AEP sync: batched update for ${data.addKeys.length} adds, ${data.removeKeys.length} removes`,
          }),
        });

        if (!res.ok) {
          const error = await res.text();
          throw new Error(`Failed to update LD segment ${segmentKey}: ${error}`);
        }

        return { forwarded: data.addKeys.length + data.removeKeys.length };
      })
    );

    results.push(...chunkResults);

    // Apply a 1-second delay if there are more chunks to process
    if (i + chunkSize < segmentEntries.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // 3. Tally results
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const segmentData = segmentEntries[i][1];
    const profileCount = segmentData.addKeys.length + segmentData.removeKeys.length;

    if (result.status === "fulfilled") {
      totalForwarded += result.value.forwarded;
    } else {
      console.error(result.reason);
      totalFailed += profileCount;
    }
  }

  return { totalForwarded, totalFailed };
}

import { getLDClient } from "./ld-client";

/**
 * Check if LaunchDarkly forwarding is enabled.
 * Evaluates the `aep-forwarding-enabled` feature flag using the Server SDK.
 */
export async function isLDEnabled(): Promise<boolean> {
  const client = await getLDClient();
  if (!client) {
    // Fallback if SDK is not configured
    return false;
  }

  const context = { kind: "system", key: "aep-backend" };
  const flagValue = await client.variation("aep-forwarding-enabled", context, false);
  
  return flagValue;
}
