# Aathvan ERP — Configurable Workspace

The app uses a Google spreadsheet as its live data store. It does not require a fixed set of factory modules: create modules with your own names and fields, then remove or restore them as your process changes. The React app connects directly to Google Sheets using the signed-in user's OAuth access token; no service-account key or Google client secret belongs in the browser.

## Google setup

1. Create a Google Cloud project and enable the **Google Sheets API**.
2. Configure the OAuth consent screen for your organization and add the Google accounts that will use the app as test users while it is in testing.
3. Create an OAuth client ID with the **Web application** type. Add the app's origin to **Authorized JavaScript origins** (for local development, `http://localhost:5173`).
4. Create a **new, blank** Google spreadsheet for the workspace. Share it with each operator's Google account with only the access they need. Copy the spreadsheet ID from the URL between `/d/` and `/edit`. The existing `Elegance Furniture.xlsx` workbook is not imported automatically.
5. Copy `.env.example` to `.env.local` and set `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_SHEET_ID`.
6. Run `npm run dev`, open the app, and choose **Connect Google Sheet**. The app creates its configuration and activity tabs. Each module gets its own data tab when you create it.

The app reads and writes the signed-in user's spreadsheet directly. Google OAuth client IDs are public identifiers, not secrets. Do not put OAuth client secrets, service-account credentials, or API keys in `VITE_*` variables.

## Modules and workbook tabs

- `ModuleConfig` stores each module's name, description, fields, and active/removed state.
- `ActivityLog` records module and record creation events.
- Each custom module gets a separate `Module_<id>` tab with the fields you configured, plus record ID and timestamps.

Use **Add a module** to configure a module name, an optional description, and up to 20 fields. Enter one field per line, optionally followed by a type: `Item name`, `Quantity: number`, `Needed by: date`, or `Details: long text`. Supported types are text (the default), number, date, and long text.

**Remove** archives a module from the workspace without deleting its sheet or records. Restore it later from **Configure modules**. Back up the spreadsheet regularly.

## Production deployment on Vercel

1. Push this repository to a private GitHub repository. Never commit `.env.local`.
2. Import that repository in Vercel. Use the default Vite settings, build command `npm run build`, and output directory `dist`.
3. Add `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_SHEET_ID` in Vercel project settings for **Production**. Add them for **Preview** only if preview deployments should access real data.
4. In Google Cloud Console, add the exact production URL (and any permitted preview URLs) under the OAuth web client’s **Authorized JavaScript origins**. Origins have no path and must match protocol and host.
5. Configure the OAuth consent screen for the intended user audience. If Google marks it as **Testing**, only listed test users can use it; publish/configure the consent app appropriately before relying on it for regular business use.
6. Deploy to Vercel, then open the production URL and test sign-in, module creation, record entry, archive/restore, and spreadsheet permissions with a non-owner Google account.

`vercel.json` supplies SPA routing and baseline browser security headers. GitHub Actions runs a clean install, lint, dependency audit, and production build for pushes and pull requests. Use Node.js 20.19 or newer.

### Important Google Sheets limits

This setup is **deployable**, but it is not a production-grade ERP security boundary. Google Sheets is the live database by request:

- Every person with edit access to the spreadsheet can directly change data and bypass app workflows. App-level hiding or archiving is not authorization.
- Google OAuth access is held in browser memory; there are no server-enforced user roles or tenant isolation.
- Sheets does not provide the transactional guarantees needed for concurrent edits or reliable offline queues.
- Protect the workbook with Google Drive sharing controls and protected ranges, give edit access only to trusted staff, and maintain version history/backups.
- Use a dedicated spreadsheet containing no unrelated private data. The OAuth app gets spreadsheet access granted by the signed-in user.

Do not use this deployment for payroll, tax, or other sensitive records, or claim compliance/security guarantees, without moving authorization and sensitive data operations behind a trusted backend.