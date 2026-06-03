# AEP Destination SDK Setup & Activation Guide

This guide walks you through the steps to configure a custom streaming destination using the **AEP Destination SDK** APIs, tailored specifically for the `aep-destination-sdk-test-app` integration with LaunchDarkly.

All API calls are made against:
```
https://platform.adobe.io/data/core/activation/authoring/...
```

With the following required headers (replace placeholders with your values):
```
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json
x-api-key: {API_KEY}
x-gw-ims-org-id: {ORG_ID}
x-sandbox-name: {SANDBOX_NAME}
```

## Project Context
Based on your application's architecture (`/api/aep/events`):
- **Authentication**: The endpoint expects **Basic Auth**.
- **Payload**: The application expects an array of profiles with an `identities` map and a `segments` map.
- **Event Frequency**: You should configure this as **Best Effort** (real-time streaming). The application processes incoming events instantly and schedules a non-blocking background task (via Next.js `after()`) to forward the segment changes to LaunchDarkly. For real-time experimentation on the site, receiving profile segment qualifications immediately is critical.
- **Identities**: The application expects the following optional identities (at least one will be present): `CIFHash` and `WebTrackerID`. (The internal DB maps `CIFHash` to authenticated user `NBID`s).

---

## Step 1: Create Destination Server Configuration
The destination server configuration defines where AEP should send the data (the HTTP endpoint, method, and message body template).

**API Call:** `POST /data/core/activation/authoring/destination-servers`

**Payload:**
```json
{
  "name": "CBA Custom Destination (CIF & WebTracker) - Non Prod",
  "destinationServerType": "URL_BASED",
  "urlBasedDestination": {
    "url": {
      "templatingStrategy": "PEBBLE_V1",
      "value": "https://aep-destination-sdk-test-app.vercel.app/api/aep/events"
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
> 
> **Sample resulting payload sent to `/api/aep/events`**:
> ```json
> {
>   "profiles": [
>     {
>       "identities": {
>         "CIFHash": [ "test-cifhash-123" ],
>         "WebTrackerID": [ "test-web-456" ]
>       },
>       "segments": {
>         "segment-uuid-1234": {
>           "status": "realized",
>           "lastQualificationTime": "2026-06-03T10:00:00Z"
>         }
>       }
>     }
>   ]
> }
> ```

**Save the returned `instanceId` — you will need it as `<DESTINATION_SERVER_ID>` in Step 3.**

---

## Step 2: Create Audience Metadata Template
This configures AEP to push human-readable segment names to our metadata endpoint whenever an audience is mapped to (or removed from) this destination. This allows LaunchDarkly to display friendly names instead of raw UUIDs.

**API Call:** `POST /data/core/activation/authoring/audience-templates`

**Payload:**
```json
{
  "metadataTemplate": {
    "name": "CBA Custom Destination (CIF & WebTracker) - Non Prod - Audience Metadata",
    "create": {
      "url": "https://aep-destination-sdk-test-app.vercel.app/api/aep/metadata",
      "httpMethod": "POST",
      "headers": [
        {
          "header": "Content-Type",
          "value": "application/json"
        }
      ],
      "requestBody": {
        "json": {
          "action": "create",
          "segments": [
            {
              "id": "{{segment.id}}",
              "name": "{{segment.name}}",
              "description":"{{segment.description}}"
            }
          ]
        }
      },
      "responseFields": [
        {
          "name": "externalAudienceId",
          "value": "{{body.segments[0].segment.id}}"
        }
      ],
      "responseErrorFields": [
        {
          "name": "message",
          "value": "{{root}}"
        }
      ]
    },
    "update": {
      "url": "https://aep-destination-sdk-test-app.vercel.app/api/aep/metadata",
      "httpMethod": "POST",
      "headers": [
        {
          "header": "Content-Type",
          "value": "application/json"
        }
      ],
      "requestBody": {
        "json": {
          "action": "update",
          "segments": [
            {
              "id": "{{segment.id}}",
              "name": "{{segment.name}}",
              "description":"{{segment.description}}"
            }
          ]
        }
      },
      "responseFields": [
        {
          "name": "externalAudienceId",
          "value": "{{body.segments[0].segment.id}}"
        }
      ],
      "responseErrorFields": [
        {
          "name": "message",
          "value": "{{root}}"
        }
      ]
    },
    "delete": {
      "url": "https://aep-destination-sdk-test-app.vercel.app/api/aep/metadata",
      "httpMethod": "POST",
      "headers": [
        {
          "header": "Content-Type",
          "value": "application/json"
        }
      ],
      "requestBody": {
        "json": {
          "action": "delete",
          "segments": [
            {
              "id": "{{segment.id}}",
              "name": "{{segment.name}}",
              "description":"{{segment.description}}"
            }
          ]
        }
      },
      "responseFields": [
        {
          "name": "externalAudienceId",
          "value": "{{body.segments[0].segment.id}}"
        }
      ],
      "responseErrorFields": [
        {
          "name": "message",
          "value": "{{root}}"
        }
      ]
    }
  }
}
```

> [!NOTE]
> **Sample resulting payload sent to `/api/aep/metadata`**:
> ```json
> {
>   "action": "create",
>   "audiences": [
>     {
>       "id": "segment-uuid-1234",
>       "name": "High-Value Home Loan Prospects"
>     }
>   ]
> }
> ```

**Save the returned `instanceId` — you will need it as `<AUDIENCE_TEMPLATE_ID>` in Step 3.**

---

## Step 3: Create the Destination Configuration
This is the main configuration — it ties together the server, the audience template, authentication, identities, delivery rules, schema mapping, and aggregation policy into one destination.

**API Call:** `POST /data/core/activation/authoring/destinations`

**Payload:**
```json
{
  "name": "CBA Custom Destination (CIF & WebTracker) - Non Prod",
  "description": "Streams AEP segment qualifications to Test Site for real time integration with LaunchDarkly Testing.",
  "status": "TEST",
  "customerAuthenticationConfigurations": [
    {
      "authType": "BASIC"
    }
  ],
  "customerDataFields": [],
  "uiAttributes": {
    "documentationLink": "https://github.com/umangm99/aep-destination-sdk-test-app",
    "category": "personalization",
    "connectionType": "Server-to-server",
    "frequency": "Streaming",
    "isBeta": false
  },
  "identityNamespaces": {
    "CIFHash": {
      "acceptsAttributes": false,
      "acceptsCustomNamespaces": true
    },
    "WebTrackerID": {
      "acceptsAttributes": false,
      "acceptsCustomNamespaces": true
    }
  },
  "schemaConfig": {
    "profileRequired": false,
    "segmentRequired": true,
    "identityRequired": true
  },
  "destinationDelivery": [
    {
      "authenticationRule": "CUSTOMER_AUTHENTICATION",
      "destinationServerId": "<DESTINATION_SERVER_ID>"
    }
  ],
  "audienceMetadataConfig": {
    "mapExperiencePlatformSegmentId": true,
    "mapExperiencePlatformSegmentName": true,
    "mapUserInput": false,
    "audienceTemplateId": "<AUDIENCE_TEMPLATE_ID>"
  },
  "segmentMappingConfig": {
    "mapExperiencePlatformSegmentId": true,
    "mapExperiencePlatformSegmentName": true,
    "mapUserInput": false
  },
  "aggregation": {
    "aggregationType": "BEST_EFFORT",
    "bestEffortAggregation": {
      "maxUsersPerRequest": 10
    }
  },
  "backfillHistoricalProfileData": true
}
```

> [!IMPORTANT]
> Replace `<DESTINATION_SERVER_ID>` with the `instanceId` from Step 1, and `<AUDIENCE_TEMPLATE_ID>` with the `instanceId` from Step 2.

### Configuration sections explained

| Section | Purpose |
|---|---|
| `customerAuthenticationConfigurations` | Tells the AEP UI to show a **Basic Auth** (username/password) screen when a user connects to this destination. Our app validates these credentials in `middleware.ts`. |
| `identityNamespaces` | Declares `CIFHash` and `WebTrackerID` as target identity namespaces. Users **must map at least one** target identity in the activation flow. `acceptsCustomNamespaces: true` lets users map any AEP custom namespace (e.g. their own CRM ID) to these target fields. |
| `schemaConfig` | `profileRequired: false` means we don't need XDM profile attributes — we only consume identities and segments. `identityRequired: true` ensures at least one identity is always sent. |
| `destinationDelivery` | Links this destination to the server from Step 1 and sets `CUSTOMER_AUTHENTICATION` so that AEP uses the credentials the user entered (Basic Auth). |
| `audienceMetadataConfig` | Links to the audience template from Step 2. `mapExperiencePlatformSegmentId/Name: true` auto-sends segment IDs and names — no manual user mapping needed. |
| `segmentMappingConfig` | Same as above — auto-maps segment IDs/names from AEP. `mapUserInput: false` prevents the user from having to manually enter segment IDs. |
| `aggregation` | `BEST_EFFORT` means AEP fires the webhook as soon as a profile qualifies. Critical for real-time experimentation. |
| `backfillHistoricalProfileData` | `true` means the first export includes all historically-qualified profiles, not just new ones. |

---

## Step 4: Test the Configuration via API
Before publishing, use the Testing API to simulate an AEP payload and verify your Next.js app successfully processes it.

**API Call:** `POST /data/core/activation/authoring/testing/destinationInstance/<DESTINATION_ID>/action/test`

**Payload:**
```json
{
  "profiles": [
    {
      "identityMap": {
        "CIFHash": [{ "id": "test-cifhash-123" }]
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
  ]
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
5. **Mapping**: Map your AEP source identity namespaces to the target identities `CIFHash` and `WebTrackerID`. You must map at least one. Since `acceptsCustomNamespaces` is `true`, you can map any custom namespace from your AEP org.
6. **Schedule**: Ensure the schedule is continuous/streaming. 
7. **Review & Save**: Finish the flow. AEP will now begin pushing segment qualification payloads directly to your `/api/aep/events` endpoint in near real-time, and segment metadata directly to `/api/aep/metadata`.
