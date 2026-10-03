# Kpakpando Airtime Tracker deployment

The browser app is a Vite single-page application. The API is a Cloudflare Worker backed by D1. They are deployed separately.

## 1. Create the D1 database

From the repository root, authenticate Wrangler and create the production database:

```sh
pnpm dlx wrangler login
pnpm dlx wrangler d1 create kpakpando-airtime-tracker
```

Copy the `database_id` returned by Cloudflare into `cloudflare/wrangler.toml`, replacing `REPLACE_WITH_D1_DATABASE_ID`.

Apply the checked-in schema to the remote database:

```sh
pnpm dlx wrangler d1 migrations apply kpakpando-airtime-tracker \
  --remote \
  --config artifacts/kpakpando-airtime-tracker/cloudflare/wrangler.toml
```

The migration creates the `airtime_entries` table and the date/payment indexes. Dates are stored as ISO calendar dates; time slots and weekdays are stored as JSON text.

## 2. Deploy the Cloudflare Worker

In `cloudflare/wrangler.toml`, replace `https://your-project.vercel.app` with the exact frontend origin. Include `https://` and the hostname only—no path or trailing slash. Separate any additional origins with commas.

Deploy:

```sh
pnpm dlx wrangler deploy \
  --config artifacts/kpakpando-airtime-tracker/cloudflare/wrangler.toml
```

Wrangler prints the Worker URL, usually `https://kpakpando-airtime-tracker-api.<account>.workers.dev`. The API routes are:

- `GET /api/entries`
- `POST /api/entries`
- `GET /api/entries/:id`
- `PUT /api/entries/:id`
- `DELETE /api/entries/:id`
- `GET /api/dashboard/summary`
- `GET /api/healthz`

Dates and summary calculations use the `Africa/Lagos` timezone. `OPTIONS` preflight requests are enabled for the listed API methods.

## 3. Deploy the Vite frontend on Vercel

1. Import the repository into Vercel and keep the project **Root Directory** at the repository root.
2. The root `vercel.json` supplies the pnpm install command, Vite build command, static output directory, and SPA route fallback.
3. In the Vercel project settings, add `VITE_API_URL` for Production. Set it to the Worker origin printed by Wrangler, with no trailing slash and no `/api` suffix, for example `https://kpakpando-airtime-tracker-api.<account>.workers.dev`. For Preview deployments, set it only after adding the exact preview origin to the Worker allow-list; otherwise leave it unset so Preview stays in clearly labeled browser-demo mode.
4. Deploy or redeploy the Vercel project.
5. Update `ALLOWED_ORIGINS` in `cloudflare/wrangler.toml` to include the exact Vercel production origin and any specific Preview origins that need live API access, then redeploy the Worker. Origins must include `https://` and a hostname only—no path or trailing slash.

Vite reads `VITE_API_URL` at build time. Without it, the app explicitly displays **Demo mode** and stores sample changes only in that browser's local storage; it does not silently switch to demo data after a live API fails.

## Access note

There are no user accounts or login pages. The Worker therefore has no user authentication: CORS limits which browser origins can read responses, but it does **not** prevent direct API clients from calling the public write endpoints. Do not put confidential data in this tracker. If access needs to be limited later, add an access-control layer before sharing the Worker publicly.