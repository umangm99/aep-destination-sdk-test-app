import { processPendingLDEvents } from "@/lib/event-processor";
import { NextResponse } from "next/server";
import { after } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow function to run for up to 60 seconds (Hobby limit)

export async function GET(request: Request) {
  // Optional: Secure the cron endpoint by verifying an Authorization header
  // provided by Vercel Cron. If not using Vercel Cron, you can use a custom secret.
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.warn("[Cron] Unauthorized attempt to trigger ld-sync.");
    return new NextResponse("Unauthorized", { status: 401 });
  }

  console.log(`[Cron] Triggered ld-sync at ${new Date().toISOString()}`);

  try {
    // Push the processing to the background so the endpoint returns immediately
    after(async () => {
      try {
        // Process up to 100 events per cron run. Since they group heavily by segment, 
        // 100 events will still usually result in only 1-2 LaunchDarkly API calls!
        const result = await processPendingLDEvents(100);
        console.log(`[Cron] Execution complete. Processed: ${result.processed}, Errors: ${result.errors}`);
      } catch (err) {
        console.error("[Cron] Background task failed:", err);
      }
    });

    // Return a 200 OK immediately to the cron scheduler
    return NextResponse.json({
      success: true,
      message: "Cron execution queued in the background.",
    });
  } catch (error) {
    console.error("Error executing cron ld-sync:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Internal Server Error during cron execution",
      },
      { status: 500 }
    );
  }
}
