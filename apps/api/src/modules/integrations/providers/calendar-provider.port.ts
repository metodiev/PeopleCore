import type { IntegrationProvider } from '@peoplecore/shared';

/** A calendar event as reported by an external provider. */
export interface ExternalCalendarEvent {
  externalId: string;
  etag?: string | null;
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  /** The provider reports the event as deleted/cancelled. */
  cancelled: boolean;
  updatedAt?: Date | null;
}

export interface PullEventsInput {
  accessToken: string;
  /** Logical calendar handle: `primary` maps to the provider's default calendar. */
  externalCalendarId: string;
  /** Incremental sync token (Google) or delta link (Microsoft), when available. */
  syncToken?: string | null;
}

export interface PulledEvents {
  events: ExternalCalendarEvent[];
  /** Token to pass on the next incremental pull. */
  nextSyncToken?: string | null;
}

export interface PushEventInput {
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
}

export interface PushedEvent {
  externalEventId: string;
  etag?: string | null;
}

export interface RefreshedToken {
  accessToken: string;
  /** Present only when the provider rotated the refresh token. */
  refreshToken?: string;
  expiresAt?: Date;
}

/**
 * Provider-agnostic calendar adapter used by the sync engine. Implementations
 * are fetch-based and stateless; credentials always come from the environment.
 *
 * A pull whose stored token was rejected by the provider must throw an
 * {@link IntegrationError} with code `SYNC_TOKEN_EXPIRED`, which makes the
 * engine fall back to a full sync.
 */
export interface CalendarProviderAdapter {
  readonly provider: IntegrationProvider;
  pullEvents(input: PullEventsInput): Promise<PulledEvents>;
  pushEvent(input: { accessToken: string; externalCalendarId: string; event: PushEventInput }): Promise<PushedEvent>;
  updateEvent(input: {
    accessToken: string;
    externalCalendarId: string;
    externalEventId: string;
    event: PushEventInput;
  }): Promise<PushedEvent>;
  deleteEvent(input: { accessToken: string; externalCalendarId: string; externalEventId: string }): Promise<void>;
  refreshAccessToken(refreshToken: string): Promise<RefreshedToken>;
}

export const MAX_PULL_PAGES = 10;
