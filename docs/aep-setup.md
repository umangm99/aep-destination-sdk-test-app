# Adobe Experience Platform (AEP) Setup Guide

This guide explains how to configure a Custom Destination in AEP to send audience events to this test application.

## Prerequisites

1. Your Next.js app must be deployed to a public URL (e.g., Vercel) or running locally via a tunnel (like Ngrok).
2. The destination URL will be: `https://<your-domain>/api/aep/events`

## 1. Create a Custom Destination

In Adobe Experience Platform:

1. Navigate to **Destinations** > **Catalog**.
2. Click **Create custom destination**.
3. Configure the Basic Information:
   - **Name**: "AEP Destination SDK Test App"
   - **Integration Type**: REST API
4. Configure Authentication:
   - **Type**: Basic Authentication
   - **Username**: Must match the `BASIC_AUTH_USERNAME` in your app's environment variables (default: `aep_test_user`)
   - **Password**: Must match the `BASIC_AUTH_PASSWORD` in your app's environment variables

## 2. Configure the HTTP Request

1. **Endpoint URL**: `https://<your-domain>/api/aep/events`
2. **HTTP Method**: POST
3. **Content Type**: application/json

## 3. Template Setup (Pebble)

To ensure this app receives the correct payload structure matching our database schema, configure the message format using the following Pebble template:

```json
{
  "profiles": [
    {% for profile in input.profiles %}
    {
      "identities": {
        {% for identityMap in profile.identityMap %}
        "{{ identityMap.key }}": [
          {% for identity in identityMap.value %}
          {
            "id": "{{ identity.id }}",
            "authenticatedState": "{{ identity.authenticatedState }}"
          }{% if loop.last == false %},{% endif %}
          {% endfor %}
        ]{% if loop.last == false %},{% endif %}
        {% endfor %}
      },
      "segments": {
        {% for segment in profile.segmentMembership.ups %}
        "{{ segment.key }}": {
          "status": "{{ segment.value.status }}",
          "lastQualificationTime": "{{ segment.value.lastQualificationTime }}"
        }{% if loop.last == false %},{% endif %}
        {% endfor %}
      }
    }{% if loop.last == false %},{% endif %}
    {% endfor %}
  ]
}
```

## 4. Identity Mapping Configuration

When configuring the destination, ensure you map the following identities so the app can correctly build the identity graph:
- `nbid` (Target Identity)
- `cifhash` (Target Identity)
- `webTrackerId` (Target Identity)
- `ecid` (Target Identity)

## 5. Activate Audiences

1. Navigate to **Audiences**.
2. Select the audiences you want to send.
3. Click **Activate to destination**.
4. Select your newly created "AEP Destination SDK Test App" destination.
5. Set up the mapping and finish activation.

Events should now begin appearing in the **Live Events** feed of your dashboard!
