# Kpakpando Airtime Tracker

Responsive radio-operations software for tracking jingles and sponsored programs, daily schedules, payment status, contract dates, and expired bookings.


## Run & Operate

- `pnpm --filter @workspace/kpakpando-airtime-tracker run dev` — run the airtime tracker preview
- `PORT=3000 BASE_PATH=/ pnpm --filter @workspace/kpakpando-airtime-tracker run build` — build the Vite frontend
- `pnpm run typecheck` — full typecheck across all packages


## Stack and architecture

- React, Vite, and TypeScript frontend
- Production API: Cloudflare Worker with Cloudflare D1
- Production frontend: Vercel static deployment
- OpenAPI contract and generated React Query client are in the workspace libraries
- Without `VITE_API_URL`, the preview is browser-only demo mode using local storage. A configured live API failure must remain an error; never silently switch to demo data.

## Where things live

- `artifacts/kpakpando-airtime-tracker/src/` — frontend and browser API adapter
- `artifacts/kpakpando-airtime-tracker/cloudflare/worker.ts` — Worker API
- `artifacts/kpakpando-airtime-tracker/cloudflare/migrations/` — D1 schema migrations
- `artifacts/kpakpando-airtime-tracker/DEPLOYMENT.md` — deployment and public-access notes
- `lib/api-spec/openapi.yaml` — API contract source of truth

## Architecture decisions

- Use Cloudflare D1 for the requested production persistence; do not replace it with the workspace PostgreSQL database.
- Interpret dates, weekdays, and display times in `Africa/Lagos`.
- An empty weekday list means a sponsored program airs every day.
- CORS restricts browsers but does not authenticate public API writes; do not treat it as access control.

## Product

- Engineers manage jingles and sponsored programs, check today's running order, track paid/unpaid and contract status, renew bookings, and review expired entries.
- The main list excludes expired bookings; the separate archive supports renewal or confirmed permanent deletion.

## User preferences

- No user accounts or login pages.
- Do not add airtime amounts or contact-person fields.
- Keep the interface and product focused on radio engineers managing the airtime log.

## Gotchas

- Set the exact deployed frontend origin(s) in `ALLOWED_ORIGINS`; preview origins differ from production.
- Browser demo data is local to one browser and is not shared or backed up.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
