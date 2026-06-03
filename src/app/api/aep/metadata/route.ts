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
  audiences?: Array<{
    id: string;
    name: string;
  }>;
}

export async function POST(request: Request) {
  // 1. Validate Basic Auth
  const auth = validateBasicAuth(request);
  if (!auth.valid) {
    return Response.json(
      { error: "Unauthorized", message: auth.error },
      { status: 401, headers: { "WWW-Authenticate": 'Basic realm="AEP Destination"' } },
    );
  }

  // 2. Parse request body
  let payload: AepMetadataPayload;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Bad Request", message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // Validate payload structure
  if (!payload.audiences || !Array.isArray(payload.audiences)) {
    return Response.json(
      {
        error: "Bad Request",
        message: 'Missing or invalid "audiences" array in payload',
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
        await processAepMetadata(payload.audiences!, action);
      } catch (err) {
        console.error(`Background Metadata ${action} sync failed`, err);
      }
    });

    return Response.json({
      success: true,
      message: `Metadata ${action} received. Syncing to database and LaunchDarkly in the background.`,
      audiences: payload.audiences.map(aud => ({ id: aud.id }))
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
