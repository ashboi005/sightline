# Tushar implementation checklist

The approved design is [tushar-design.md](tushar-design.md). Decisions and terms are recorded in [decisions.md](decisions.md) and [glossary.md](glossary.md). Execution evidence and remaining external checks are in [tushar-progress.md](tushar-progress.md).

1. Implement the entire SessionStore in Postgres, preserving memory parity, user ownership, stable ordering, caption refinement precedence and atomic initial context creation. Make better-auth cookies work in local HTTP and production HTTPS; provision the mock user for real persistence.
2. Add durable job and current-revision records, transactional enqueue/status publication, token fencing, renewable leases, three attempts, restart reclaim and per-session serialization. Preserve previous notes and expose terminal errors. Deletion queues retryable external cleanup after cancelling other work.
3. Associate every source, image and TTS asset with its session. Check owner authentication before bytes are read. Persist source bytes before accepting slide work. Implement Poppler PDF rendering/text extraction and LibreOffice PPT/PPTX conversion with isolated temporary directories, timeouts and cleanup.
4. Implement bounded chunks, batched OpenAI embeddings, structured glossary/topics/keyterms, versioned Qdrant collection replacement, cached glossary hydration, isolated retrieval and safe deletion. Fence alias publication against newer revisions/deletion and reconcile ambiguous responses before cleanup.
5. Implement confident slide/bullet matching with current-slide hysteresis and bounded query caches.
6. Build the Mastra outline/write/assemble notes workflow, bounded transcript partitions and concurrency two. Validate source references and formulas, label context supplements, render deterministic Markdown and compute exact BOARD/source overlap.
7. Wire flags, startup/recovery/shutdown, migrations, converter images, a development Compose stack, valid document fixtures and polling smoke tests. Validate deterministic behavior, then explicitly enabled real services and provider calls. Report unrun checks and unmeasured targets honestly.

Public engine interfaces and wire schemas remain unchanged. Internal asset, persistence and job ports carry the additional ownership, recovery and publication information. No frontend, recognition, live AI providers or VPS deployment is included.
