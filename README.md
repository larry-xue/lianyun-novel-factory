# Lianyun Novel Factory

Lianyun Novel Factory is an open-source workbench for building AI-assisted web novel production pipelines.

It combines a web UI, agent workflows, prompt management, living story documents, batch jobs, and run tracing into one local-first application. The goal is not to publish content automatically, but to give authors and builders a transparent system for designing, generating, reviewing, and iterating long-form fiction.

## Status

This is the **v0.1.0** release. The current kernel is built on Mastra-style agents and local harness services. A future version is planned to experiment with a Pi Agent powered runtime.

## Features

- Story workbench for ideas, books, chapters, style samples, hooks, and anti-patterns.
- Multi-step agent pipeline for story design, chapter planning, chapter writing, quality checks, and maintenance summaries.
- Living documents for characters, world rules, relationships, lore, milestones, and style notes.
- Prompt repository with editable prompt versions.
- PostgreSQL-backed run tracing for LLM calls and replay/debug workflows.
- Batch production queue powered by pg-boss.
- OpenAI-compatible LLM endpoint support, configured by `.env` or the settings page.
- Local TXT style-sample import for files that you own or have permission to process.

## Tech Stack

- TanStack Start
- React
- Drizzle ORM
- PostgreSQL 16 / pgvector Docker image
- Mastra
- pg-boss
- Vitest
- pnpm

## Quick Start

Prerequisites:

- Node.js 22+
- pnpm 10.6+
- Docker with Compose

```bash
pnpm install
pnpm db:up
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The web app runs at `http://localhost:3000` by default.

Create an admin user:

```bash
pnpm tsx scripts/create-user.ts <username> <password> admin
```

## Configuration

`.env.example` contains the local defaults.

```bash
LLM_API_ENDPOINT=https://api.openai.com/v1
LLM_API_KEY=replace-me
LLM_MODEL=gpt-4o-mini
DATABASE_URL=postgresql://lianyun:lianyun_dev@localhost:5433/lianyun
BATCH_CONCURRENCY=2
```

Use an OpenAI-compatible endpoint. Do not commit real keys.

## Scripts

```bash
pnpm dev          # Start the TanStack app
pnpm mastra:dev   # Start Mastra DevTools
pnpm typecheck    # TypeScript check
pnpm test         # Vitest suite
pnpm check        # typecheck + test
pnpm db:up        # Start local Postgres
pnpm db:migrate   # Apply migrations
pnpm db:seed      # Seed prompts and element data
pnpm db:reset     # Reset local database volume and seed again
```

## Project Layout

- `app/routes/` - TanStack Start routes
- `app/server/db/` - Drizzle schema and database client
- `app/server/services/` - production pipeline, run tracing, gates, prompts, and domain services
- `app/server/prompts/` - prompt fragments and system prompts
- `app/server/mastra/` - Mastra agent registrations
- `scripts/seed/` - seed data
- `drizzle/migrations/` - generated SQL migrations
- `docs/` - architecture notes and implementation decisions

## Content And Copyright

This project does not include copyrighted novel text samples and does not provide download, scraping, DRM bypass, paid-content bypass, or platform automation features.

If you import style samples, only use content that you wrote, own, generated lawfully, or have permission to process. The TXT importer reads a local file selected by the user and does not upload or fetch external content by itself.

Generated fiction may still require human review for originality, safety, platform compliance, and publishing rights.

## Roadmap

- v0.1.x: stabilize the current Mastra/harness pipeline and public docs.
- v0.2: evaluate replacing the kernel with Pi Agent while keeping the web workbench and database surfaces.
- Later: sandboxed agent execution, richer replay UI, exportable story packs, and plugin-style prompt/agent packs.

## License

MIT
