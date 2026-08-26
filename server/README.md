# bumper-usage-server

Small API that tracks the free-tier monthly quota and Pro-tier billing for Bumper. Deployed and versioned separately from the `bumper-guard` npm package — this never ships to users, only the daemon in `../src` talks to it.

Until this is deployed and a Bumper install points at it (`BUMPER_SERVER_URL`), every install runs fully unlimited and fully local — this being offline changes nothing for existing users.

## Endpoints

- `POST /usage/check { deviceId }` — read-only, current plan + remaining bumps. Doesn't consume one.
- `POST /usage/consume { deviceId }` — called once per "ask" decision. Decrements the free counter, or returns `{ allowed: false }` once it's at zero.
- `GET /checkout?deviceId=...&email=...` — redirects into a Stripe Checkout session for the Pro subscription.
- `POST /webhook/stripe` — Stripe calls this on `checkout.session.completed` / `customer.subscription.deleted` to flip an account between `free` and `pro`.
- `GET /health`

Free-tier counters live in `data/accounts.json` (flat file, gitignored) and reset automatically at the start of each calendar month — no cron job needed. Swap for real Postgres before this needs to survive more than one process or serious traffic.

## Run locally (no accounts needed)

```bash
npm install
npm start
```

Runs on `:8787` with Stripe unconfigured — `/usage/check` and `/usage/consume` work immediately (`FREE_ASKS_PER_MONTH` in `.env`, default 15), `/checkout` returns a 501 until you add Stripe keys.

Point a local Bumper daemon at it:

```bash
BUMPER_SERVER_URL=http://localhost:8787 bumper start
```

## Going live — what you need to set up

1. **Host it somewhere with a public URL.** Fly.io or Railway both have a free tier that's enough to start (`fly launch` / `railway up` from this directory).
2. **Stripe** (free to create, no monthly fee):
   - Create a Product + a recurring Price for the Pro plan → copy the Price ID into `STRIPE_PRICE_ID`.
   - Copy your secret key (`sk_test_...` while testing, `sk_live_...` once real) into `STRIPE_SECRET_KEY`.
   - Add a webhook endpoint in the Stripe dashboard pointing at `https://<your-host>/webhook/stripe`, listening for `checkout.session.completed` and `customer.subscription.deleted` → copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Set `CHECKOUT_SUCCESS_URL` / `CHECKOUT_CANCEL_URL` to real pages once you have a landing site.
4. Once deployed, point installs at it: `BUMPER_SERVER_URL=https://<your-host>` (env var, or `"serverUrl"` in `~/.bumper/config.json`) — or bake it as the CLI's default once you're ready for it to apply to everyone.

See `.env.example` for the full list of env vars.
