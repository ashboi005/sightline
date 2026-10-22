# Sightline: how it fits together

Paste either block into [mermaid.live](https://mermaid.live) (or view it on GitHub) to get the picture.

## 1. The system

Everything time-critical runs on the student's laptop; the server does captions, slides, notes and storage; AI is
called through APIs.

```mermaid
flowchart TB
  subgraph LAPTOP["Student's laptop: everything real-time"]
    direction LR
    TRACKER["Eye tracker<br/>(our hardware)"] --> BRIDGE["Gaze bridge<br/>screen / board / person"]
    MIC["Room mic"]
    SCENE["Scene camera"]
    WEBCAM["Webcam"]
    BRIDGE --> WEB["Sightline web app<br/>(browser)"]
    MIC --> WEB
    SCENE --> WEB
    WEBCAM --> WEB
    WEB <-->|"mic + faces"| SPEAKER["Look-to-hear engine<br/>RTFS-Net voice isolation"]
    SPEAKER -->|"the voice you look at"| EAR["Earphones"]
  end

  SIGN["Sign recognition model<br/>(tunnel)"]

  subgraph SERVER["Sightline server (Coolify VPS)"]
    direction LR
    API["REST + live WebSocket<br/>Bun, Elysia, better-auth"] --> LIVE["Live captions<br/>speech-to-text, glossary,<br/>formulas, slide pointer"]
    API --> JOBS["Background jobs<br/>slides, context, notes"]
    LIVE --> PG[("Postgres")]
    JOBS --> PG
    JOBS --> QD[("Qdrant<br/>lecture knowledge")]
    JOBS --> S3[("S3<br/>slides, audio,<br/>snapshots, recordings")]
  end

  subgraph AI["AI services (APIs)"]
    direction LR
    STT["ElevenLabs Scribe<br/>speech to text"]
    LLM["Merge gateway<br/>Gemini, Grok, GLM"]
    TTS["ElevenLabs / Sarvam<br/>text to speech"]
    EMB["Gemini embeddings"]
    STT ~~~ LLM ~~~ TTS ~~~ EMB
  end

  LAPTOP <-->|"live captions, slide pointer, gaze events, notes<br/>(recordings upload straight to S3)"| SERVER
  LAPTOP <-->|"webcam frames / recognised signs"| SIGN
  SERVER -->|"speech-to-text, LLMs, text-to-speech, embeddings"| AI
```

## 2. One lecture, start to finish

```mermaid
flowchart TD
  subgraph BEFORE["Before class"]
    B1["Student uploads slides<br/>or pastes the topic"] --> B2["Slides rendered + text extracted"]
    B2 --> B3["LLM builds the lecture glossary<br/>(Sridharacharya, discriminant, Vieta...)"]
    B2 --> B4["Text indexed in Qdrant"]
    B3 --> B5["Glossary primes speech-to-text"]
  end

  subgraph DURING["During class"]
    D1["Teacher speaks"] --> D2["Words appear live<br/>(under a second)"]
    D2 --> D3["Sentence ends: caption line"]
    D3 --> D4["Glossary fixes jargon<br/>LLM turns spoken maths into formulas"]
    D4 --> D5["Line upgrades in place<br/>+ slide preview follows"]

    G1["Student looks up at the board"] --> G2["Captions pause at a bookmark<br/>(in the browser, no server)"]
    G2 --> G3["Looks back: missed lines highlighted,<br/>then catch up"]

    V1["Teacher: 'let me draw on the board'"] --> V2["Scene-camera snapshot<br/>+ AI description"]

    S1["Student signs a question"] --> S2["Sign model: glosses"] --> S3["LLM writes the sentence"] --> S4["Spoken aloud (TTS)"]

    H1["Hard-of-hearing mode:<br/>student looks at a person"] --> H2["That person's voice isolated<br/>into the earphones"]
  end

  subgraph AFTER["After class"]
    A1["End lecture"] --> A2["Notes in ~15 s: sections, formulas,<br/>definitions, board snapshots,<br/>where the student looked away"]
    A2 --> A3["Export, recording with transcript"]
  end

  B5 --> D1
  D5 --> A1
  V2 --> A2
  G3 --> A2
```
