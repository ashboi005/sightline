/**
 * Server-internal ports between the two backend modules. Keep this file tiny.
 *
 *   modules/live      (Ashwath — core)        implements SessionLifecycle, SessionEvents
 *   modules/platform  (Tushar — surrounding)  implements SessionStore, AssetStore, KnowledgeEngine, NotesEngine, UserResolver
 *
 * Each module only ever sees the other through these interfaces (plus the contract-level
 * CaptionEngine / KnowledgeEngine / NotesEngine in @sightline/contracts), so either side can be mocked.
 */
import type { Session, SessionServerMessage } from "@sightline/contracts";

/** Push a message to every socket watching a session. Implemented by the live module's hub. */
export interface SessionEvents {
  publish(sessionId: string, message: SessionServerMessage): void;
}

/** Platform tells the live module when a session changes state. Implemented by the live module. */
export interface SessionLifecycle {
  onSessionStarted(session: Session): Promise<void>;
  onSessionEnded(sessionId: string): Promise<void>;
  onSessionDeleted(sessionId: string): Promise<void>;
}

export type { AssetStore } from "../modules/platform/assets/asset-store";
export type { UserResolver } from "../modules/platform/auth";
export type { SessionStore } from "../modules/platform/store/types";
