-- Bumper usage server schema.
--
-- Two tables, deliberately not more:
--   accounts       — one row per device/user, identity + plan + Stripe linkage
--   usage_periods  — one row per account per calendar month, the actual counter
--
-- Usage is split into its own table (rather than a single mutable counter on
-- accounts) so a month's data is a permanent, queryable row instead of
-- something that gets overwritten at rollover — that history is exactly what
-- the roadmap's "set the free limit from real numbers" step needs, and it
-- means concurrent requests can't race a lazy in-place reset.
--
-- Deliberately NOT stored anywhere: command text, file paths, code content.
-- The daemon only ever sends a device id — see src/account.js on the CLI
-- side and README.md's Privacy section.

create extension if not exists pgcrypto;

create table accounts (
  id                     uuid primary key default gen_random_uuid(),
  device_id              text not null unique,
  email                  text unique,
  plan                   text not null default 'free' check (plan in ('free', 'pro')),
  stripe_customer_id     text unique,
  stripe_subscription_id text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table usage_periods (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references accounts(id) on delete cascade,
  period_start date not null,
  asks_used    integer not null default 0,
  asks_limit   integer not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (account_id, period_start)
);

create index idx_usage_periods_account on usage_periods (account_id);
