-- Email + verification-code auth. No passwords: a signup or login both go
-- through the same flow — request a code, verify it, get a session token.

create table verification_codes (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  code       text not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index idx_verification_codes_email on verification_codes (email);

-- One token per login — a fresh `bumper login` or web login issues a new
-- row rather than reusing one, so any device/browser can be revoked on its
-- own by deleting its row.
create table sessions (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  token      text not null unique,
  kind       text not null check (kind in ('cli', 'web')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index idx_sessions_token on sessions (token);
create index idx_sessions_account on sessions (account_id);
