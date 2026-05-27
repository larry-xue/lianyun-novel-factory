# AGENTS.md

## Project

Lianyun Novel Factory is an AI web novel production workbench built with TanStack Start, Drizzle, PostgreSQL, Mastra, pg-boss, and Vitest.

## Rules

- Do not commit real credentials, `.env`, logs, generated outputs, or private writing samples.
- Do not add copyrighted text samples unless redistribution rights are explicit.
- Keep user-facing wording platform-neutral.
- Keep schema changes paired with Drizzle migrations.
- Prefer focused tests for prompt fragments, services, and serialization boundaries.

## Commands

```bash
pnpm install
pnpm db:up
pnpm db:migrate
pnpm typecheck
pnpm test
```

Use `pnpm test:live` only with explicit LLM credentials and intent.
