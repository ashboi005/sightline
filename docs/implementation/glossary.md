# Platform domain glossary

| Term | Meaning |
| --- | --- |
| Lecture session | One student's lecture, progressing DRAFT → LIVE → ENDED. Distinct from a better-auth login session. |
| Context | Typed lecture description and extracted slide text, plus generated topics and glossary. |
| Glossary alias | Likely speech-recognition misspelling of a canonical lecture term. |
| Context chunk | A bounded source passage with slide/bullet coordinates where available. |
| Collection alias | Stable Qdrant name pointing to the currently published context collection. |
| Job revision | The current job ID for one session and work kind; older work cannot publish database results. |
| Lease token | Unique claim identity used to fence a worker after a job is reclaimed. |
| Source asset | Persisted uploaded file used to resume conversion after restart. |
| Notes draft | Structured generated notes before server-owned note ID and generation timestamp are assigned. |
| Context supplement | Supporting information not present in the spoken transcript, explicitly labelled in notes. |
| Away window | Time away from the screen, separated by gaze zone and clamped to lecture bounds. |
| Board-heavy section | Note section with at least ten seconds of actual BOARD/source interval overlap. |
