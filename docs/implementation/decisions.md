# Platform architectural decisions

## ADR 001: recoverable jobs in Postgres

Use the existing database rather than adding Redis or a separate worker service. Job inputs, current revisions, lease tokens and visible status changes are persisted transactionally. A short advisory transaction lock coordinates claims across processes. Per-session locks serialize mutations and external index publication; claims skip busy sessions. Other work executes outside those locks. Expired leases are reclaimable, capped at three attempts; result publication checks the current revision and token. Memory jobs provide equivalent development behavior without restart persistence.

## ADR 002: private session assets

Preserve asset URLs while authenticating every request and checking ownership through SessionStore. Store session association in asset metadata. This also applies to TTS output, requiring the minimal live-module call-site change. Return private/no-store caching to avoid shared-cache disclosure and stale authorization.

## ADR 003: replace knowledge through collection aliases

Build revision-specific Qdrant collections and publish through a stable per-session alias. Failed ingestion does not destroy the previous usable index. Check the job revision before publication. Persist successful glossary metadata in the session context; hydrate the memory cache before accepting live traffic. External index operations are idempotent under retries; cleanup removes all collections with that session's exact prefix.

## ADR 004: transcript-led notes

Spoken content is authoritative. Context supplies definitions and corrections; unspoken supplements must be labelled. Empty transcripts fail clearly. Model-generated references are checked, formulas are collected from caption parts, and Markdown is deterministic. Gaze annotations count actual overlapping time rather than the full away window for every section.

## ADR 005: approved checkout and verification

Use the explicitly approved existing sightline checkout. Do not create commits or branches. The general Desktop/Codex-projects preference does not move this project. Docker-first conversion avoids requiring Windows installations of office converters. External services and credentials are verified only when available; tests must distinguish real services from injected deterministic adapters.
