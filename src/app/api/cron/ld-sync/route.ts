import { processPendingLDEvents } from "@/lib/event-processor";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Optional: Secure the cron endpoint by verifying an Authorization header
  // provided by Vercel Cron. If not using Vercel Cron, you can use a custom secret.
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    // Process up to 25 events per cron run.
    const result = await processPendingLDEvents(25);

    return NextResponse.json({
      success: true,
      processed: result.processed,
      errors: result.errors,
      message: "Cron execution successful",
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
