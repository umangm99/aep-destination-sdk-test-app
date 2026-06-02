# AEP Destination SDK Test App

A Next.js application designed to receive, process, and visualize audience segment events from Adobe Experience Platform (AEP) in real time. It acts as a Custom Destination.

## Features

- **Realtime Dashboard**: View incoming events, active profiles, and segment metrics instantly.
- **Advanced Identity Resolution**: Automatically maps `nbid`, `cifhash`, `cif`, `webTrackerId`, and `ecid` across authenticated and unauthenticated states.
- **AEP Webhook Receiver**: Secure POST endpoint with Basic Authentication.
- **LaunchDarkly Forwarding**: (Optional) Forwards segment memberships to LaunchDarkly for external experimentation using Vercel background tasks (`next/server after()`).

## Architecture

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

## AEP Configuration

To configure AEP to send data to this application, please refer to the detailed guide:
👉 [AEP Setup Guide](./docs/aep-setup.md)
