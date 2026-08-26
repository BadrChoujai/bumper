# bumper-usage-server

Small API that tracks the free-tier monthly quota and Pro-tier billing for Bumper. Deployed and versioned separately from the `bumper-guard` npm package — this never ships to users, only the daemon in `../src` talks to it.

Until this is deployed and a Bumper install points at it (`BUMPER_SERVER_URL`), every install runs fully unlimited and fully local — this being offline changes nothing for existing users.

## Data model

Two tables (`migrations/001_init.sql`):

- **`accounts`** — one row per device/user: `device_id`, `email`, `plan` (`free`/`pro`), Stripe customer/subscription IDs.
- **`usage_periods`** — one row per account per calendar month: `asks_used` / `asks_limit`. Kept separate from `accounts` so each month is a permanent row instead of a counter that gets overwritten — gives you real history for the "set the free limit from actual usage" step later, and makes the check-and-increment on `/usage/consume` a single atomic SQL statement (`INSERT ... ON CONFLICT ... WHERE asks_used < asks_limit`) — race-safe under concurrent requests with no separate locking needed.

Nothing else is stored server-side — no command text, file paths, or code content ever reach this database. See `src/db.js` / `src/store.js`.

## Endpoints

- `POST /usage/check { deviceId }` — read-only, current plan + remaining bumps. Doesn't consume one.
- `POST /usage/consume { deviceId }` — called once per "ask" decision. Decrements the free counter, or returns `{ allowed: false }` once it's at zero.
- `GET /checkout?deviceId=...&email=...` — redirects into a Stripe Checkout session for the Pro subscription.
- `POST /webhook/stripe` — Stripe calls this on `checkout.session.completed` / `customer.subscription.deleted` to flip an account between `free` and `pro`.
- `GET /health`

Free-tier counters reset automatically at the start of each calendar month — computed on read, no cron job needed.

## Run locally (Postgres needed, no accounts needed)

Point `DATABASE_URL` at any Postgres — a throwaway local one works fine for development:

```bash
docker run -d --name bumper-dev-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=bumper -p 5544:5432 postgres:16-alpine
echo "DATABASE_URL=postgres://postgres:dev@localhost:5544/bumper" >> .env
npm install
npm run migrate
npm start
```

Runs on `:8787` with Stripe unconfigured — `/usage/check` and `/usage/consume` work immediately (`FREE_ASKS_PER_MONTH` in `.env`, default 15), `/checkout` returns a 501 until you add Stripe keys.

Point a local Bumper daemon at it:

```bash
BUMPER_SERVER_URL=http://localhost:8787 bumper start
```

## Going live — what you need to set up

1. **Postgres.** Supabase or Neon both have a free tier that's plenty to start — create a project, copy its connection string into `DATABASE_URL`, then run `npm run migrate` once against it.
2. **Host it somewhere with a public URL.** Render/Cloud Run free tiers work but spin down when idle, adding cold-start latency to whichever "ask" event wakes them back up — an always-on host (a small VM, or a tunnel into a machine you already run) avoids that if it matters to you.
3. **Stripe** (free to create, no monthly fee):
   - Create a Product + a recurring Price for the Pro plan → copy the Price ID into `STRIPE_PRICE_ID`.
   - Copy your secret key (`sk_test_...` while testing, `sk_live_...` once real) into `STRIPE_SECRET_KEY`.
   - Add a webhook endpoint in the Stripe dashboard pointing at `https://<your-host>/webhook/stripe`, listening for `checkout.session.completed` and `customer.subscription.deleted` → copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Set `CHECKOUT_SUCCESS_URL` / `CHECKOUT_CANCEL_URL` to real pages once you have a landing site.
5. Once deployed, point installs at it: `BUMPER_SERVER_URL=https://<your-host>` (env var, or `"serverUrl"` in `~/.bumper/config.json`) — or bake it as the CLI's default once you're ready for it to apply to everyone.

See `.env.example` for the full list of env vars.
