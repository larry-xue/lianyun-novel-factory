# Security Policy

## Reporting

Please report security issues privately by opening a GitHub security advisory or contacting the repository owner. Do not disclose exploitable details in public issues before a fix is available.

## Secrets

Never commit real LLM API keys, database credentials, session cookies, or private story material. Use `.env` locally and keep `.env.example` limited to placeholders.

## Runtime Notes

The current version runs local tools and LLM workflows in the application process. Treat it as a trusted local development app. If you expose it beyond localhost, put it behind authentication, use a private network, and review tool access carefully.
