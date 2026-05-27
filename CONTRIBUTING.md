# Contributing

Thanks for considering a contribution.

## Local Setup

```bash
pnpm install
pnpm db:up
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Checks

Run focused tests while developing, then run the full gate before opening a PR:

```bash
pnpm typecheck
pnpm test
```

Database-backed tests expect the local Docker Postgres service from `pnpm db:up`.

## Contribution Rules

- Do not commit real API keys, credentials, local `.env` files, generated logs, or private user content.
- Do not add copyrighted novel samples unless they are clearly licensed for redistribution.
- Keep prompt and agent changes covered by focused tests when possible.
- Keep schema changes paired with Drizzle migrations.
- Prefer small PRs with a clear behavior summary and verification notes.

## Content Policy

This repository is a tool for AI-assisted writing workflows. It does not host copyrighted source novels and does not implement scraping, paid-content bypass, or platform automation.
