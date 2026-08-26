# bumper-usage-server

API behind Bumper's login and usage tracking. Deployed and versioned separately from the `bumper-guard` npm package — this never ships to users, only the daemon in `../src` talks to it. The published CLI points at this server by default now (`src/account.js`'s `DEFAULT_SERVER_URL`) — Bumper requires being logged in to protect anything; it's no longer an opt-in add-on.

## Data model

Four tables (`migrations/`):

- **`accounts`** — one row per user: `device_id` (the device that first created the row — historical, not the identity once an email is attached), `email`, `plan` (`free`/`pro`), Stripe customer/subscription IDs.
- **`usage_periods`** — one row per account per calendar month: `asks_used` / `asks_limit`. Kept separate from `accounts` so each month is a permanent row instead of a counter that gets overwritten, and makes the check-and-increment on `/usage/consume` a single atomic SQL statement (`INSERT ... ON CONFLICT ... WHERE asks_used < asks_limit`) — race-safe under concurrent requests, no separate locking needed. Currently not enforced — see `ENFORCE_QUOTA` below.
- **`verification_codes`** — email + 6-digit code + 10-minute expiry, for the login flow. No passwords anywhere.
- **`sessions`** — one row per login (CLI or web), each with its own token — a device or browser can be revoked on its own without touching the others.

Nothing else is stored server-side — no command text, file paths, or code content ever reach this database. See `src/db.js` / `src/store.js` / `src/auth.js`.

## Endpoints

- `POST /auth/request-code { email }` — sends a 6-digit code via Resend (or logs it to the console if `RESEND_API_KEY` isn't set — that's how local dev works with zero email setup). Rate-limited to one request per email per 30s.
- `POST /auth/verify { email, code, deviceId?, kind? }` — verifies the code, creates the account if it's the first time this email has logged in (or attaches the email to an existing anonymous `deviceId` account, carrying over its usage), returns a session token.
- `GET /auth/session` — `Authorization: Bearer <token>`, used by the daemon to gate every `/check`.
- `POST /usage/check { deviceId }` — read-only, current plan + remaining bumps. Doesn't consume one.
- `POST /usage/consume { deviceId }` — called once per "ask" decision. Decrements the free counter, or returns `{ allowed: false }` once it's at zero — only when `ENFORCE_QUOTA=true`.
- `GET /checkout?deviceId=...&email=...` — redirects into a Stripe Checkout session for the Pro subscription.
- `POST /webhook/stripe` — Stripe calls this on `checkout.session.completed` / `customer.subscription.deleted` to flip an account between `free` and `pro`.
- `GET /health`

Free-tier counters reset automatically at the start of each calendar month — computed on read, no cron job needed. Set `ENFORCE_QUOTA=true` to actually enforce it — off by default right now, so every logged-in account is unlimited during early access.

## Run locally (Postgres needed)

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
5. **Resend** (free, no card) for the actual login codes — an API key alone only sends to your own verified address via the sandbox sender; a verified domain is needed before other people's emails will receive anything.
6. The CLI already points at the production host by default (`src/account.js`) — nothing else to wire up once this is deployed.

See `.env.example` for the full list of env vars.
