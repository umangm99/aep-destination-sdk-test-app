/**
 * POST /api/aep/events — Main endpoint for receiving AEP audience events.
 * Validates Basic Auth, processes the payload, stores in DB, and forwards to LD.
 */

import { validateBasicAuth } from "@/lib/auth";
import { processAEPEvent, type AEPPayload } from "@/lib/event-processor";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rawBody = await request.text();

  // Log the incoming request to Vercel for debugging AEP payloads
  console.log(`[AEP Events] Incoming POST request`);
  console.log(`[AEP Events] Headers:`, Object.fromEntries(request.headers.entries()));
  console.log(`[AEP Events] Body:`, rawBody);

  // 1. Validate Basic Auth
  const auth = validateBasicAuth(request);
  if (!auth.valid) {
    console.error(`[AEP Events] Auth failed: ${auth.error}`);
    return Response.json(
      { error: "Unauthorized", message: auth.error },
      { status: 401, headers: { "WWW-Authenticate": 'Basic realm="AEP Destination"' } },
    );
  }

  // 2. Parse request body
  let payload: AEPPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error(`[AEP Events] Invalid JSON body`);
    return Response.json(
      { error: "Bad Request", message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // Validate payload structure
  if (!payload.profiles || !Array.isArray(payload.profiles)) {
    return Response.json(
      {
        error: "Bad Request",
        message: 'Missing or invalid "profiles" array in payload',
      },
      { status: 400 },
    );
  }

  // 3. Process the event
  try {
    const sourceIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";

    const result = await processAEPEvent(payload, sourceIp);

    console.log(`[AEP Events] Successfully queued event processing (EventId: ${result.eventId}).`);

    return Response.json({
      success: true,
      eventId: result.eventId,
      profilesProcessed: result.profilesProcessed,
      segmentsProcessed: result.segmentsProcessed,
      message: "Event ingested. LaunchDarkly sync will be handled by background cron."
    });
  } catch (error) {
    console.error("Error processing AEP event:", error);
    return Response.json(
      {
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

// Return 405 for other methods
export async function GET() {
  return Response.json(
    {
      error: "Method Not Allowed",
      message: "This endpoint only accepts POST requests from AEP",
      usage: "POST /api/aep/events with Basic Auth and JSON body",
    },
    { status: 405 },
  );
}
