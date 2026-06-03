/**
 * LaunchDarkly integration via REST API.
 * Forwards AEP segment membership changes to LD segments.
 *
 * Context key fallback: nbid → webtrackerid
 * CIFHash is NEVER sent to LD — only used for identity_mapping lookups.
 */

import type { Profile } from "@/db/schema";

interface SegmentChange {
  segmentId: string;
  segmentName?: string;
  status: string; // "realized", "existing", "exited"
}

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
 */
async function ensureLDSegment(
  config: LDConfig,
  segmentKey: string,
  segmentName: string,
  description?: string,
): Promise<boolean> {
  const url = `${LD_API_BASE}/segments/${config.projectKey}/${config.environmentKey}/${segmentKey}`;

  // Check if segment exists
  const getRes = await fetch(url, {
    headers: {
      Authorization: config.apiKey,
    },
  });

  if (getRes.ok) return true;

  if (getRes.status === 404) {
    // Create the segment
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
      return true;
    }

    const error = await createRes.text();
    console.error(`Failed to create LD segment ${segmentKey}: ${error}`);
    return false;
  }

  console.error(`Failed to check LD segment ${segmentKey}: ${getRes.status}`);
  return false;
}

/**
 * Update a profile's membership in an LD segment.
 */
async function updateSegmentMembership(
  config: LDConfig,
  segmentKey: string,
  contextKey: string,
  action: "add" | "remove",
): Promise<boolean> {
  const url = `${LD_API_BASE}/segments/${config.projectKey}/${config.environmentKey}/${segmentKey}`;

  const instruction =
    action === "add"
      ? {
          kind: "addIncludedTargets",
          contextKind: "user",
          values: [contextKey],
        }
      : {
          kind: "removeIncludedTargets",
          contextKind: "user",
          values: [contextKey],
        };

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: config.apiKey,
      "Content-Type": "application/json; domain-model=launchdarkly.semanticpatch",
    },
    body: JSON.stringify({
      instructions: [instruction],
      comment: `AEP sync: ${action} context ${contextKey}`,
    }),
  });

  if (res.ok) return true;

  const error = await res.text();
  console.error(
    `Failed to ${action} context ${contextKey} in LD segment ${segmentKey}: ${error}`,
  );
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

  // If 404, it might not exist yet; ensure it exists with the new name and description
  if (res.status === 404) {
    return ensureLDSegment(config, segmentKey, segmentName, description);
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
    return true;
  }

  if (res.status === 404) {
    console.log(`LD segment ${segmentKey} already deleted or not found.`);
    return true; // Already gone, consider success
  }

  const error = await res.text();
  console.error(`Failed to delete LD segment ${segmentKey}: ${error}`);
  return false;
}

/**
 * Forward segment changes for a single profile to LaunchDarkly.
 * Returns the number of successful segment updates.
 */
export async function forwardToLaunchDarkly(
  profile: { nbid?: string | null; webTrackerId?: string | null; },
  segmentChanges: SegmentChange[],
): Promise<{ forwarded: number; failed: number }> {
  const config = getLDConfig();
  if (!config) return { forwarded: 0, failed: 0 };

  const contextKey = resolveLDContextKey(profile);
  if (!contextKey) {
    console.warn("Cannot forward to LD: no usable context key for profile");
    return { forwarded: 0, failed: 0 };
  }

  let forwarded = 0;
  let failed = 0;

  // Process segment changes in parallel with concurrency limit
  const results = await Promise.allSettled(
    segmentChanges.map(async (change) => {
      const segmentKey = sanitizeSegmentKey(change.segmentId);

      // Ensure segment exists
      const exists = await ensureLDSegment(config, segmentKey, change.segmentName);
      if (!exists) return false;

      // Determine action
      const action: "add" | "remove" =
        change.status === "realized" || change.status === "existing"
          ? "add"
          : "remove";

      return updateSegmentMembership(config, segmentKey, contextKey, action);
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      forwarded++;
    } else {
      failed++;
    }
  }

  return { forwarded, failed };
}

/**
 * Batch forward segment changes for multiple profiles.
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

  // Process profiles in parallel
  const results = await Promise.allSettled(
    entries.map(({ profile, segmentChanges }) =>
      forwardToLaunchDarkly(profile, segmentChanges),
    ),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      totalForwarded += result.value.forwarded;
      totalFailed += result.value.failed;
    } else {
      totalFailed++;
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
