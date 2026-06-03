# AEP Destination SDK Test App

A Next.js application designed to receive, process, and visualize audience segment events and metadata from Adobe Experience Platform (AEP) in real time. It acts as a Custom Destination via the Destination SDK and syncs AEP segment memberships directly to LaunchDarkly for real-time personalization and experimentation.

## Core Capabilities

- **Realtime AEP Webhook Receiver**: Secure POST endpoints (`/api/aep/events` and `/api/aep/metadata`) with Basic Authentication designed to handle AEP's "Best Effort" streaming aggregation.
- **Advanced Identity Resolution**: Extract the user's `CIFHash` or `WebTrackerID`. Attempt to resolve the true `NBID` via the `identity_mapping` table. (If a `CIFHash` doesn't exist, it dynamically generates and locks mock identifiers).
- **Audience Metadata Sync**: Automatically ingests AEP segment metadata mapping, storing human-readable segment names instead of raw UUIDs.
- **LaunchDarkly Forwarding**: Forwards segment memberships and metadata updates to LaunchDarkly using a background Cron sweep (`/api/cron/ld-sync` triggered via **cron-job.org**) to ensure webhook responses are instant and respect LaunchDarkly rate limits.
- **Realtime Dashboard**: View incoming events, active profiles, and segment metrics instantly.

## Architecture & Data Flow

1. **AEP Qualifies a User**: A user qualifies for a segment in AEP.
2. **Profile Streaming**: AEP immediately streams a webhook payload to `/api/aep/events` containing the segment UUIDs and user identities.
3. **Database Upsert**: The app resolves the identity graph (merging ECIDs with NBIDs/CIFs) and updates the local Postgres database.
4. **LaunchDarkly Sync**: An external cron job via [cron-job.org](https://cron-job.org) continuously pings the app to process queued segments in the background. The app uses LaunchDarkly's REST API to add/remove the user from the corresponding LD segment using their `NBID` or `WebTrackerID` as the context key.
5. **Metadata Sync**: When audiences are mapped in AEP, AEP pushes the human-readable names to `/api/aep/metadata`, which updates the local DB and sends a JSON patch to rename the segment in LaunchDarkly.

## LaunchDarkly Sync (Cron Job)

Because AEP webhooks can spike in volume, this application queues LaunchDarkly segment updates in the database and processes them asynchronously in batches of 25. This ensures we strictly respect LaunchDarkly's rate limits (max 15/sec) and allows for automatic retries.

To process the queue, you must configure a free external cron service (such as [cron-job.org](https://cron-job.org/)) to ping the synchronization endpoint every 1 minute:
- **Endpoint**: `https://your-domain.vercel.app/api/cron/ld-sync`
- **Method**: `GET`
- **Headers**: `Authorization: Bearer <CRON_SECRET>` (The secret must match the `CRON_SECRET` defined in your environment variables)

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Database**: Neon Postgres (Serverless) + Drizzle ORM
- **Hosting**: Designed for Vercel (Free Hobby Tier compatible)

## Getting Started

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Copy the environment variables template:
   ```bash
   cp .env.example .env.local
   ```

3. Configure your database:
   - Create a free Postgres database at [Neon.tech](https://neon.tech)
   - Update `DATABASE_URL` in `.env.local`

4. Push the database schema:
   ```bash
   npm run build # if using Drizzle migrations, or npx drizzle-kit push
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

## AEP Configuration & Setup

To configure AEP to send streaming profiles and audience metadata to this application via the Destination SDK, please refer to the detailed guide:
👉 [AEP Destination SDK Setup Guide](./docs/aep-destination-sdk-setup-guide.md)
