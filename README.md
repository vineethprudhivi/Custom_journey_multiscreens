# Multi-Screen Custom Journey Builder Activity — POC

A proof-of-concept Salesforce Marketing Cloud (SFMC) Journey Builder custom activity with a **3-screen configuration UI**. The activity demonstrates how to collect form data, generate a Communication ID (GUID) via a CloudPage, display Entry DE schema fields, and preview Entry DE records — all within a single custom activity iframe.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Journey Builder (SFMC)                                 │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Custom Activity iframe (index.html)              │  │
│  │  ┌────────┐  ┌──────────────┐  ┌──────────────┐  │  │
│  │  │Screen 1│→ │   Screen 2   │→ │   Screen 3   │  │  │
│  │  │ Form   │  │ DE Fields    │  │ Preview + ID │  │  │
│  │  └───┬────┘  └──────────────┘  └──────┬───────┘  │  │
│  └──────┼────────────────────────────────┼───────────┘  │
│         │ POST /webhook/submit           │ GET /de/     │
│         ▼                                ▼ entry-records│
│  ┌──────────────────────────────────────────────────┐   │
│  │  Vercel (Node.js / Express)  — routes/activity.js│   │
│  └──────┬───────────────────────────────┬───────────┘   │
│         │ Proxy POST                    │ SFMC REST API │
│         ▼                               ▼               │
│  ┌────────────────┐        ┌────────────────────────┐   │
│  │ SFMC CloudPage │        │ SFMC REST API          │   │
│  │ (JSON Code     │        │ /interaction/v1/...    │   │
│  │  Resource)     │        │ /data/v1/...           │   │
│  │                │        └────────────────────────┘   │
│  │ • GUID()       │                                     │
│  │ • Webhook DE   │                                     │
│  │ • Tracking DE  │                                     │
│  └────────────────┘                                     │
└─────────────────────────────────────────────────────────┘
```

---
Entry DE:
<img width="1700" height="393" alt="image" src="https://github.com/user-attachments/assets/d254e190-a97d-47f9-8ab2-fdc376064d42" />

## Screens

### Screen 1 — Template Form (Webhook)

- User fills in **First Name**, **Last Name**, **Email** (required), **Phone**, and **Country**.
- On clicking **Next**, the form data is POSTed to the Vercel backend (`/webhook/submit`), which proxies it to an **SFMC CloudPage JSON Code Resource**.
- The CloudPage generates a **Communication ID** (GUID) via `Platform.Function.GUID()` and writes:
  - **Webhook DE** — stores the form fields + GUID.
  - **Job Tracking DE** — stores the GUID, email, status, and timestamp.
- The GUID and per-DE save statuses are returned to the UI.
<img width="800" height="529" alt="image" src="https://github.com/user-attachments/assets/7a5e3a88-b9c2-4caa-adf3-ef1004876ccb" />

### Screen 2 — Entry DE Fields

- Automatically displays all **field names** from the journey's Entry Data Extension.
- Fields are resolved from the Postmonger `requestedSchema` event (format: `Event.<DEKey>.<FieldName>`).
- Shows field name, type, and full schema key in a table.
<img width="800" height="519" alt="image" src="https://github.com/user-attachments/assets/508f4e33-60c0-4273-970d-5e38d3fcc276" />

### Screen 3 — Preview & Submit

- Fetches and displays the **top 2 records** from the Entry DE for preview/testing.
- The Entry DE is auto-resolved from the journey's Event Definition Key (no manual configuration needed).
- Shows the generated **Communication ID (Job ID)** from Screen 1.
- **Save & Done** button triggers `updateActivity` via Postmonger, persisting `inArguments` (field mappings, Job ID, Entry DE key) for the execute step.
<img width="800" height="403" alt="image" src="https://github.com/user-attachments/assets/66135ba6-06d6-4c54-8e55-9f2bf5fdcaf1" />

---
Form fields DE: 

<img width="800" height="153" alt="image" src="https://github.com/user-attachments/assets/9de2f8f5-dcb8-49c7-9850-759ea032a32d" />
job tracking DE:

<img width="1228" height="991" alt="image" src="https://github.com/user-attachments/assets/a351aee7-44c5-48d7-9c29-ca65a3c83efb" />
cloudpage:

<img width="800" height="426" alt="image" src="https://github.com/user-attachments/assets/75fb63bf-88df-42bf-8e36-2d43cebc695f" />


## Project Structure

```
├── app.js                          # Express server entry point
├── config.json                     # Root config (mirror of public/config.json)
├── vercel.json                     # Vercel deployment config
├── package.json                    # Node.js dependencies
│
├── routes/
│   ├── activity.js                 # Backend: webhook proxy, DE record fetch, JB lifecycle
│   └── index.js                    # Basic route handlers
│
├── public/
│   ├── index.html                  # 3-screen custom activity UI
│   ├── config.json                 # JB activity config (steps, endpoints, schema)
│   ├── css/
│   │   └── styles.css              # Salesforce-style UI styling
│   ├── js/
│   │   ├── test.js                 # Main client-side logic (Postmonger + navigation)
│   │   ├── postmonger.js           # Postmonger library (JB ↔ iframe communication)
│   │   └── uuid.js                 # UUID library (not used for GUID generation)
│   └── images/                     # Activity icons
│
└── cloudpage_ssjs/
    └── webhook_json_code_resource.html   # SSJS code for SFMC CloudPage
```

---

## Key Files

| File | Purpose |
|------|---------|
| `public/index.html` | 3-screen frontend UI (form, field list, preview table) |
| `public/config.json` | JB activity configuration (steps, endpoints, schema) |
| `public/js/test.js` | Client-side JS — Postmonger flow, AJAX calls, navigation |
| `routes/activity.js` | Server-side — CloudPage proxy (~line 179), Entry DE fetch (~line 270), JB lifecycle handlers |
| `cloudpage_ssjs/webhook_json_code_resource.html` | SFMC CloudPage SSJS — GUID generation + DE writes |

---

## Communication ID (GUID) Generation

The Communication ID is generated **exclusively on the SFMC CloudPage** using `Platform.Function.GUID()`. There is no server-side or client-side UUID generation. The flow:

1. Client submits form → Vercel `/webhook/submit`
2. Vercel proxies the POST to the CloudPage (`CLOUDPAGE_WEBHOOK_URL` env var)
3. CloudPage runs `Platform.Function.GUID()` → writes to both DEs → returns JSON with the GUID
4. Vercel forwards the CloudPage response to the client
5. Client displays the GUID on Screen 1 and persists it in `inArguments` on save

---

## Setup

### Prerequisites

- **SFMC Installed Package** — Server-to-Server integration with permissions for Journeys, Data Extensions, and Cloud Pages.
- **SFMC CloudPage** — JSON Code Resource containing the SSJS code from `cloudpage_ssjs/webhook_json_code_resource.html`.
- **Two Data Extensions** in SFMC:
  - **Webhook DE** — fields: `email` (PK), `firstname`, `lastname`, `phone`, `country`, `jobId`
  - **Job Tracking DE** — fields: `jobId` (PK), `email`, `status`, `createdDate`
- **Vercel account** for hosting.

### SFMC Configuration

1. Create an **Installed Package** with a JB Activity component.
2. Set the activity endpoint URL to `https://<your-vercel-app>.vercel.app`.
3. Create a **JSON Code Resource** CloudPage and paste the SSJS code from `cloudpage_ssjs/webhook_json_code_resource.html`.
4. Update the DE external keys in the CloudPage SSJS to match your Data Extensions.

### Vercel Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SUBDOMAIN` | SFMC API subdomain (BU-specific) | `mc4by0xw84s11pznjgq1c45n7qr0` |
| `CLIENT_ID` | Installed Package client ID | `abcdef123456...` |
| `CLIENT_SECRET` | Installed Package client secret | `xyz789...` |
| `CLOUDPAGE_WEBHOOK_URL` | Full URL of the JSON Code Resource CloudPage | `https://mc...sfmc-content.com/...` |

### Deployment

```bash
# Install dependencies
npm install

# Run locally
npm start

# Deploy to Vercel
vercel --prod
```

---

## How It Works at Runtime

1. **Configuration time** (when a marketer drags the activity into a journey):
   - Screen 1: Fill form → CloudPage generates GUID → saves to DEs.
   - Screen 2: View Entry DE field names from journey schema.
   - Screen 3: Preview Entry DE records → Save activity with `inArguments`.

2. **Execution time** (when a contact enters the journey):
   - JB calls `/execute` with resolved `inArguments` (field mappings contain actual contact values).
   - The backend upserts the contact data into a destination DE.

---

## License

Open-sourced under the MIT License. See the [LICENSE](LICENSE) file for details.
