import * as LaunchDarkly from '@launchdarkly/node-server-sdk';

// Extending globalThis to cache the LD client across Hot Module Reloads (HMR)
// Without this, Next.js development mode would initialize a new connection on every file change.
declare global {
  var __ldClient: LaunchDarkly.LDClient | undefined;
}

/**
 * Initializes and returns the LaunchDarkly Node Server SDK client.
 * Uses a singleton pattern to prevent memory leaks in development.
 */
export async function getLDClient(): Promise<LaunchDarkly.LDClient | null> {
  const sdkKey = process.env.LAUNCHDARKLY_SDK_KEY;

  if (!sdkKey) {
    console.warn("LAUNCHDARKLY_SDK_KEY is not set. LaunchDarkly feature flags will be disabled.");
    return null;
  }

  // If we already have an initialized client, return it
  if (globalThis.__ldClient) {
    return globalThis.__ldClient;
  }

  const client = LaunchDarkly.init(sdkKey);
  
  try {
    await client.waitForInitialization({ timeout: 5 });
    console.log("LaunchDarkly SDK successfully initialized!");
  } catch (err) {
    console.error("LaunchDarkly SDK failed to initialize:", err);
  }

  // Cache the client instance globally
  globalThis.__ldClient = client;

  return client;
}
