// Action Logger — singleton wrapper around EventStore for convenient action logging
// Initialize with the platform's EventStore instance at boot.
// Provides typed convenience methods for logging different action categories.
// All logging is fire-and-forget: failures are silently caught so they never
// break the calling code.

import { EventStore } from './event-store'

let store: EventStore | null = null

/** Wire up the action logger with an initialised EventStore. Call once at boot. */
export function initActionLogger(eventStore: EventStore): void {
  store = eventStore
}

/** Get the underlying EventStore (or null if not yet initialised). */
export function getActionLogger(): EventStore | null {
  return store
}

/** Fire-and-forget: append an action event. Never throws. */
export function logAction(
  type: string,
  payload: Record<string, any>,
  opts?: {
    actor?: string
    sessionId?: string
    causationId?: string
    correlationId?: string
  },
): void {
  if (!store) return
  store
    .append({
      type,
      payload,
      actor: opts?.actor ?? 'system',
      sessionId: opts?.sessionId,
      causationId: opts?.causationId,
      correlationId: opts?.correlationId,
    })
    .catch(() => {
      // Logging must never break the caller — swallow errors silently.
    })
}
