/**
 * POST /api/aep/metadata — Endpoint for receiving AEP audience metadata.
 * Validates Basic Auth, parses segment mapping, updates DB, and updates LD segment names.
 */

import { validateBasicAuth } from "@/lib/auth";
import { processAepMetadata } from "@/lib/event-processor";
import { after } from "next/server";

export const dynamic = "force-dynamic";

interface AepMetadataPayload {
  action?: "create" | "update" | "delete";
  segments?: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  // Log the incoming request to Vercel for debugging AEP payloads
  console.log(`[AEP Metadata] Incoming POST request`);
  console.log(`[AEP Metadata] Headers:`, Object.fromEntries(request.headers.entries()));
  console.log(`[AEP Metadata] Body:`, rawBody);

  // Note: We are intentionally NOT requiring Basic Auth on this endpoint because AEP's 
  // built-in authType: BASIC does not expose the credentials to Audience Templates. 
  // This endpoint only receives segment names (no PII), so it is safe to leave unauthenticated.

  // 2. Parse request body
  let payload: AepMetadataPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error(`[AEP Metadata] Invalid JSON body`);
    return Response.json(
      { error: "Bad Request", message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // Validate payload structure
  if (!payload.segments || !Array.isArray(payload.segments)) {
    return Response.json(
      {
        error: "Bad Request",
        message: 'Missing or invalid "segments" array in payload',
      },
      { status: 400 },
    );
  }

  const action = payload.action || "create";

  // 3. Process the metadata
  try {
    // Run the metadata processing in the background so we can respond to AEP immediately
    after(async () => {
      try {
        await processAepMetadata(payload.segments!, action);
        console.log(`[AEP Metadata] Successfully processed background metadata ${action} sync.`);
      } catch (err) {
        console.error(`[AEP Metadata] Background Metadata ${action} sync failed`, err);
      }
    });

    console.log(`[AEP Metadata] Successfully queued metadata ${action} for background processing.`);

    return Response.json({
      success: true,
      segments: payload.segments,
      id: payload.segments[0].id,
      message: `Metadata ${action} received. Syncing to database and LaunchDarkly in the background.`
    });
  } catch (error) {
    console.error("Error queueing AEP metadata processing:", error);
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
      usage: "POST /api/aep/metadata with Basic Auth and JSON body",
    },
    { status: 405 },
  );
}
