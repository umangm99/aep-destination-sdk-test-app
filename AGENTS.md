<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project Context: AEP Destination SDK Test App

This project acts as an Adobe Experience Platform (AEP) Custom Destination. It receives streaming segment qualifications from AEP and syncs them to LaunchDarkly in real-time.

## Key Directories & Files
- `/src/app/api/aep/events/route.ts`: Ingests profile/segment events from AEP (Basic Auth).
- `/src/app/api/aep/metadata/route.ts`: Ingests audience metadata (names) from AEP (Basic Auth).
- `/src/lib/event-processor.ts`: Core business logic. Resolves identity graphs and triggers database/LD updates.
- `/src/lib/launchdarkly.ts`: Handles LaunchDarkly REST API interactions (syncing memberships, updating segment names).
- `/docs/aep-destination-sdk-setup-guide.md`: The definitive guide for configuring the Destination in AEP via API.

## Architectural Notes
- **Background Sync**: We use Next.js `after()` to immediately return a 200 OK to AEP while forwarding data to LaunchDarkly in the background. Do not make background network calls block the webhook response.
- **Identity Hierarchy**: AEP will only pass `CIFHash`, `WebTrackerID`, or `ECID` (at least 1 per profile). The app extracts these, resolves the corresponding canonical `NBID` from the local identity mapping table, and uses the resolved `NBID` or `WebTrackerID` as the primary context key for LaunchDarkly.
- **Database**: We use Neon Postgres via Drizzle ORM (`/src/db/schema.ts`).
