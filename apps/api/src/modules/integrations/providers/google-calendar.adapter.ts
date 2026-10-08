import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../config/configuration.js';
import { IntegrationError } from '../../../common/errors/app-error.js';
import {
  MAX_PULL_PAGES,
  type CalendarProviderAdapter,
  type ExternalCalendarEvent,
  type PullEventsInput,
  type PulledEvents,
  type PushedEvent,
  type PushEventInput,
  type RefreshedToken,
} from './calendar-provider.port.js';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FULL_SYNC_PAST_DAYS = 30;
const FULL_SYNC_FUTURE_DAYS = 365;

interface GoogleEvent {
  id?: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

/** Google Calendar adapter (Calendar API v3, `primary` calendar by default). */
@Injectable()
export class GoogleCalendarAdapter implements CalendarProviderAdapter {
  readonly provider = 'GOOGLE' as const;
  private readonly logger = new Logger(GoogleCalendarAdapter.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async pullEvents(input: PullEventsInput): Promise<PulledEvents> {
    const events: ExternalCalendarEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;
    let pages = 0;

    do {
      const params = new URLSearchParams({ maxResults: '250', showDeleted: 'true' });
      if (input.syncToken) {
        params.set('syncToken', input.syncToken);
      } else {
        const now = Date.now();
        params.set('singleEvents', 'true');
        params.set('orderBy', 'startTime');
        params.set('timeMin', new Date(now - FULL_SYNC_PAST_DAYS * 86_400_000).toISOString());
        params.set('timeMax', new Date(now + FULL_SYNC_FUTURE_DAYS * 86_400_000).toISOString());
      }
      if (pageToken) params.set('pageToken', pageToken);

      const response = await fetch(
        `${CALENDAR_API}/calendars/${encodeURIComponent(input.externalCalendarId)}/events?${params.toString()}`,
        { headers: { authorization: `Bearer ${input.accessToken}` } },
      );
      if (response.status === 410) {
        throw new IntegrationError('The Google sync token expired', 'SYNC_TOKEN_EXPIRED');
      }
      if (!response.ok) {
        throw new IntegrationError(
          `Google Calendar pull failed (${response.status}): ${(await response.text()).slice(0, 200)}`,
          'PROVIDER_REQUEST_FAILED',
        );
      }

      const payload = (await response.json()) as {
        items?: GoogleEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
      };
      for (const item of payload.items ?? []) {
        const mapped = this.mapEvent(item);
        if (mapped) events.push(mapped);
      }
      nextSyncToken = payload.nextSyncToken ?? nextSyncToken;
      pageToken = payload.nextPageToken;
      pages += 1;
    } while (pageToken && pages < MAX_PULL_PAGES);

    return { events, nextSyncToken };
  }

  async pushEvent(input: {
    accessToken: string;
    externalCalendarId: string;
    event: PushEventInput;
  }): Promise<PushedEvent> {
    const body = this.eventBody(input.event);
    const response = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(input.externalCalendarId)}/events?sendUpdates=none`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${input.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      throw new IntegrationError(
        `Google Calendar push failed (${response.status}): ${(await response.text()).slice(0, 200)}`,
        'PROVIDER_REQUEST_FAILED',
      );
    }
    const payload = (await response.json()) as GoogleEvent;
    if (!payload.id) throw new IntegrationError('Google did not return the created event id', 'PROVIDER_BAD_RESPONSE');
    return { externalEventId: payload.id, etag: payload.etag ?? null };
  }

  async updateEvent(input: {
    accessToken: string;
    externalCalendarId: string;
    externalEventId: string;
    event: PushEventInput;
  }): Promise<PushedEvent> {
    const response = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(input.externalCalendarId)}/events/${encodeURIComponent(input.externalEventId)}?sendUpdates=none`,
      {
        method: 'PATCH',
        headers: { authorization: `Bearer ${input.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(this.eventBody(input.event)),
      },
    );
    if (!response.ok) {
      throw new IntegrationError(
        `Google Calendar update failed (${response.status}): ${(await response.text()).slice(0, 200)}`,
        'PROVIDER_REQUEST_FAILED',
      );
    }
    const payload = (await response.json()) as GoogleEvent;
    return { externalEventId: input.externalEventId, etag: payload.etag ?? null };
  }

  async deleteEvent(input: {
    accessToken: string;
    externalCalendarId: string;
    externalEventId: string;
  }): Promise<void> {
    const response = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(input.externalCalendarId)}/events/${encodeURIComponent(input.externalEventId)}?sendUpdates=none`,
      { method: 'DELETE', headers: { authorization: `Bearer ${input.accessToken}` } },
    );
    // 404/410 mean the event is already gone — that is the desired state.
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      throw new IntegrationError(`Google Calendar delete failed (${response.status})`, 'PROVIDER_REQUEST_FAILED');
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<RefreshedToken> {
    const { clientId, clientSecret } = this.config.oauth.google;
    if (!clientId || !clientSecret) {
      throw new IntegrationError('Google OAuth is not configured on this server', 'OAUTH_NOT_CONFIGURED');
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!response.ok) {
      this.logger.warn(`Google token refresh failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
      throw new IntegrationError('Google refused to refresh the access token', 'TOKEN_REFRESH_FAILED');
    }

    const payload = (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : undefined,
    };
  }

  private mapEvent(item: GoogleEvent): ExternalCalendarEvent | null {
    if (!item.id) return null;
    const start = googleDate(item.start);
    const end = googleDate(item.end);
    const allDay = Boolean(item.start?.date && !item.start?.dateTime);
    if (!start) return null;

    return {
      externalId: item.id,
      etag: item.etag ?? null,
      title: item.summary ?? '(untitled)',
      description: item.description ?? null,
      location: item.location ?? null,
      startAt: start,
      // Google's all-day end date is exclusive; store the inclusive last millisecond.
      endAt: this.endDate(end, start, allDay),
      allDay,
      cancelled: item.status === 'cancelled',
      updatedAt: item.updated ? new Date(item.updated) : null,
    };
  }

  private endDate(end: Date | null, start: Date, allDay: boolean): Date {
    if (!end) return new Date(start.getTime() + 3_600_000);
    if (!allDay) return end;
    // All-day: `end.date` is the day after the last day of the event.
    return new Date(Math.max(end.getTime() - 1, start.getTime()));
  }

  private eventBody(event: PushEventInput) {
    const body: Record<string, unknown> = {
      summary: event.title,
      description: event.description ?? undefined,
      location: event.location ?? undefined,
      start: googleBodyDate(event.startAt, event.allDay, false),
      end: googleBodyDate(event.endAt, event.allDay, true),
    };
    return body;
  }
}

function googleDate(value?: { dateTime?: string; date?: string }): Date | null {
  if (value?.dateTime) {
    const parsed = new Date(value.dateTime);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value?.date) {
    const parsed = new Date(`${value.date}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function googleBodyDate(date: Date, allDay: boolean, exclusive: boolean) {
  if (!allDay) return { dateTime: date.toISOString(), timeZone: 'UTC' };
  const normalized = exclusive ? new Date(date.getTime() + 1) : date;
  return { date: normalized.toISOString().slice(0, 10) };
}
