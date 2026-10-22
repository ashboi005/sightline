/**
 * OWNER: Ashwath. Fan-out of SessionServerMessage to every socket watching a session.
 */
import type { SessionServerMessage } from "@sightline/contracts";

import type { SessionEvents } from "../../../shared/ports";

export type Subscriber = { id: string; send: (data: string) => void };

export class SessionHub implements SessionEvents {
  private readonly subscribers = new Map<string, Map<string, Subscriber>>();

  subscribe(sessionId: string, subscriber: Subscriber): () => void {
    let subs = this.subscribers.get(sessionId);
    if (!subs) {
      subs = new Map();
      this.subscribers.set(sessionId, subs);
    }
    subs.set(subscriber.id, subscriber);
    return () => {
      subs.delete(subscriber.id);
      if (subs.size === 0) this.subscribers.delete(sessionId);
    };
  }

  count(sessionId: string): number {
    return this.subscribers.get(sessionId)?.size ?? 0;
  }

  publish(sessionId: string, message: SessionServerMessage): void {
    const data = JSON.stringify(message);
    for (const sub of this.subscribers.get(sessionId)?.values() ?? []) {
      try {
        sub.send(data);
      } catch (error) {
        console.warn(`[hub] send failed for ${sub.id}`, error);
      }
    }
  }
}
