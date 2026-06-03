# AEP Destination SDK Setup & Activation Guide

This guide walks you through the steps to configure a custom streaming destination using the **AEP Destination SDK** APIs, tailored specifically for the `aep-destination-sdk-test-app` integration with LaunchDarkly. 

## Project Context
Based on your application's architecture (`/api/aep/events`):
- **Authentication**: The endpoint expects **Basic Auth**.
- **Payload**: The application expects an array of profiles with an `identities` map and a `segments` map.
- **Event Frequency**: You should configure this as **Best Effort** (real-time streaming). The application processes incoming events instantly and schedules a non-blocking background task (via Next.js `after()`) to forward the segment changes to LaunchDarkly. For real-time experimentation on the site, receiving profile segment qualifications immediately is critical.
- **Identities**: The application expects the following optional identities (at least one will be present): `CIFHash`, `WebTrackerID`, and `ECID`. (The internal DB maps `CIFHash` to authenticated user `NBID`s).

---

## Step 1: Create Destination Server Configuration
The destination server configuration defines where AEP should send the data and how to authenticate.

**API Call:** `POST /data/core/activation/authoring/destination-servers`

**Payload Example:**
```json
{
  "name": "TestBank App Server",
  "destinationServerType": "URL_BASED",
  "urlBasedDestination": {
    "url": {
      "templatingStrategy": "PEBBLE_V1",
      "value": "https://<YOUR_APP_DOMAIN>/api/aep/events"
    }
  },
  "httpTemplate": {
    "requestBody": {
      "templatingStrategy": "PEBBLE_V1",
      "value": "{\n  \"profiles\": [\n    {%- for profile in input.profiles -%}\n      {\n        \"identities\": {\n          {%- for identityMap in profile.identityMap -%}\n            \"{{ identityMap.key }}\": [ {%- for identity in identityMap.value -%} \"{{ identity.id }}\" {% if not loop.last %},{% endif %} {%- endfor -%} ] {% if not loop.last %},{% endif %}\n          {%- endfor -%}\n        },\n        \"segments\": {\n          {%- for segment in profile.segmentMembership.ups -%}\n            \"{{ segment.key }}\": {\n              \"status\": \"{{ segment.value.status }}\",\n              \"lastQualificationTime\": \"{{ segment.value.lastQualificationTime }}\"\n            } {% if not loop.last %},{% endif %}\n          {%- endfor -%}\n        }\n      } {% if not loop.last %},{% endif %}\n    {%- endfor -%}\n  ]\n}"
    },
    "httpMethod": "POST",
    "contentType": "application/json"
  }
}
```
> [!NOTE]
> The `requestBody` template above uses Pebble templating to map AEP's internal profile structure exactly to the `AEPPayload` interface expected by your `route.ts`.

---

## Step 2: Create the Destination Configuration
This configures the UI representation of the destination and maps the identities and delivery policies.

**API Call:** `POST /data/core/activation/authoring/destinations`

**Payload Example:**
```json
{
  "name": "TestBank Real-Time LD Integration",
  "description": "Streams AEP segment qualifications to TestBank to update LaunchDarkly flags.",
  "status": "TEST",
  "destinationServerId": "<DESTINATION_SERVER_ID_FROM_STEP_1>",
  "integrationType": "HTTP_API",
  "category": "CUSTOM",
  "identityNamespaces": {
    "eligibility": "ANY",
    "namespaces": [
      { "name": "CIFHash", "restrictions": { "required": false } },
      { "name": "WebTrackerID", "restrictions": { "required": false } },
      { "name": "ECID", "restrictions": { "required": false } }
    ]
  },
  "authOptions": [
    {
      "type": "BASIC_AUTH",
      "fields": [
        { "name": "username", "type": "STRING", "isRequired": true },
        { "name": "password", "type": "PASSWORD", "isRequired": true }
      ]
    }
  ],
  "aggregation": {
    "aggregationType": "BEST_EFFORT",
    "bestEffortAggregation": {
      "maxUsersPerRequest": 10
    }
  }
}
```

> [!IMPORTANT]
> **Aggregation Type**: Setting the aggregation to `BEST_EFFORT` ensures that as soon as a user qualifies for a segment in AEP, the webhook is immediately triggered. This is critical for driving instantaneous web experiments via LaunchDarkly.

---

## Step 3: Create Audience Metadata Configuration
This configures AEP to push human-readable segment names to our metadata endpoint whenever an audience is mapped to this destination, allowing LaunchDarkly to display friendly names instead of UUIDs.

**API Call:** `POST /data/core/activation/authoring/audience-metadata`

**Payload Example:**
```json
{
  "destinationId": "<DESTINATION_ID_FROM_STEP_2>",
  "audienceMetadataServer": {
    "urlBasedDestination": {
      "url": {
        "templatingStrategy": "PEBBLE_V1",
        "value": "https://<YOUR_APP_DOMAIN>/api/aep/metadata"
      }
    },
    "httpTemplate": {
      "requestBody": {
        "templatingStrategy": "PEBBLE_V1",
        "value": "{\n  \"audiences\": [\n    {%- for audience in input.audiences -%}\n      {\n        \"id\": \"{{ audience.id }}\",\n        \"name\": \"{{ audience.name }}\"\n      } {% if not loop.last %},{% endif %}\n    {%- endfor -%}\n  ]\n}"
      },
      "httpMethod": "POST",
      "contentType": "application/json"
    }
  }
}
```

---

## Step 4: Test the Configuration via API
Before publishing, use the Testing API to simulate an AEP payload and verify your Next.js app successfully processes it.

**API Call:** `POST /data/core/activation/authoring/testing/destinations`

**Payload Example:**
```json
{
  "destinationId": "<DESTINATION_ID_FROM_STEP_2>",
  "profiles": [
    {
      "identityMap": {
        "NBID": [{ "id": "test-nbid-123" }]
      },
      "segmentMembership": {
        "ups": {
          "segment-123": {
            "status": "realized",
            "lastQualificationTime": "2026-06-03T00:00:00Z"
          }
        }
      }
    }
  ],
  "authData": {
    "type": "BASIC_AUTH",
    "basicAuth": {
      "username": "<YOUR_BASIC_AUTH_USERNAME>",
      "password": "<YOUR_BASIC_AUTH_PASSWORD>"
    }
  }
}
```
*Verify that the API returns a 200 OK and that the event was processed by looking at your application's database (`raw_events` and `profiles` tables).*

---

## Step 5: Publish the Destination
Once testing is successful, you can update the destination status from `TEST` to `PUBLISHED` (or submit it for review depending on your AEP setup).

**API Call:** `PUT /data/core/activation/authoring/destinations/<DESTINATION_ID>`
Change the `"status"` field to `"PUBLISHED"`.

---

## Step 6: Activate Audiences (AEP UI)

Now that the destination is live, you can activate audiences via the standard Adobe Experience Platform UI:

1. **Navigate to Destinations**: Go to **Destinations > Catalog**.
2. **Find your Destination**: Search for "TestBank Real-Time LD Integration" and click **Set up**.
3. **Authenticate**: When prompted, enter your Basic Auth credentials configured in your `.env` (`BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD`).
4. **Select Audiences**: Pick the segments you want to forward to the site (e.g., "High-Value Home Loan Prospects").
5. **Mapping**: Since the destination relies on predefined `identityNamespaces` mapped in Step 2, map the appropriate AEP source identities to the target destination identities (`CIFHash`, `WebTrackerID`, `ECID`). Note: Profiles will always include at least one of these identities.
6. **Schedule**: Ensure the schedule is continuous/streaming. 
7. **Review & Save**: Finish the flow. AEP will now begin pushing segment qualification payloads directly to your `/api/aep/events` endpoint in near real-time, and segment metadata directly to `/api/aep/metadata`.
