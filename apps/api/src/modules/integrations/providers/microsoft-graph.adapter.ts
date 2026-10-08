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

const GRAPH = 'https://graph.microsoft.com/v1.0';
const FULL_SYNC_PAST_DAYS = 30;
const FULL_SYNC_FUTURE_DAYS = 365;

interface GraphEvent {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
  location?: { displayName?: string };
  lastModifiedDateTime?: string;
  changeKey?: string;
  '@odata.etag'?: string;
  '@removed'?: { reason?: string };
}

/** Microsoft Graph adapter (the signed-in user's default calendar). */
@Injectable()
export class MicrosoftGraphAdapter implements CalendarProviderAdapter {
  readonly provider = 'MICROSOFT' as const;
  private readonly logger = new Logger(MicrosoftGraphAdapter.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async pullEvents(input: PullEventsInput): Promise<PulledEvents> {
    const events: ExternalCalendarEvent[] = [];
    let nextSyncToken: string | null = null;
    let pages = 0;

    // A stored delta link is followed verbatim; otherwise the calendar view of
    // the user's default calendar is requested (distinguished per `@odata`).
    let url: string | null = input.syncToken ?? this.initialDeltaUrl();
    while (url && pages < MAX_PULL_PAGES) {
      const response = await fetch(url, { headers: this.headers(input.accessToken) });
      if (response.status === 410) {
        throw new IntegrationError('The Microsoft delta link expired', 'SYNC_TOKEN_EXPIRED');
      }
      if (!response.ok) {
        throw new IntegrationError(
          `Microsoft Graph pull failed (${response.status}): ${(await response.text()).slice(0, 200)}`,
          'PROVIDER_REQUEST_FAILED',
        );
      }

      const payload = (await response.json()) as {
        value?: GraphEvent[];
        '@odata.nextLink'?: string;
        '@odata.deltaLink'?: string;
      };
      for (const item of payload.value ?? []) {
        const mapped = this.mapEvent(item);
        if (mapped) events.push(mapped);
      }
      nextSyncToken = payload['@odata.deltaLink'] ?? nextSyncToken;
      url = payload['@odata.nextLink'] ?? null;
      pages += 1;
    }

    return { events, nextSyncToken };
  }

  async pushEvent(input: {
    accessToken: string;
    externalCalendarId: string;
    event: PushEventInput;
  }): Promise<PushedEvent> {
    const response = await fetch(`${GRAPH}/me/events`, {
      method: 'POST',
      headers: { ...this.headers(input.accessToken), 'content-type': 'application/json' },
      body: JSON.stringify(this.eventBody(input.event)),
    });
    if (!response.ok) {
      throw new IntegrationError(
        `Microsoft Graph push failed (${response.status}): ${(await response.text()).slice(0, 200)}`,
        'PROVIDER_REQUEST_FAILED',
      );
    }
    const payload = (await response.json()) as GraphEvent;
    if (!payload.id) throw new IntegrationError('Microsoft Graph did not return the created event id', 'PROVIDER_BAD_RESPONSE');
    return { externalEventId: payload.id, etag: payload['@odata.etag'] ?? payload.changeKey ?? null };
  }

  async updateEvent(input: {
    accessToken: string;
    externalCalendarId: string;
    externalEventId: string;
    event: PushEventInput;
  }): Promise<PushedEvent> {
    const response = await fetch(`${GRAPH}/me/events/${encodeURIComponent(input.externalEventId)}`, {
      method: 'PATCH',
      headers: { ...this.headers(input.accessToken), 'content-type': 'application/json' },
      body: JSON.stringify(this.eventBody(input.event)),
    });
    if (!response.ok) {
      throw new IntegrationError(
        `Microsoft Graph update failed (${response.status}): ${(await response.text()).slice(0, 200)}`,
        'PROVIDER_REQUEST_FAILED',
      );
    }
    const payload = (await response.json()) as GraphEvent;
    return { externalEventId: input.externalEventId, etag: payload['@odata.etag'] ?? payload.changeKey ?? null };
  }

  async deleteEvent(input: {
    accessToken: string;
    externalCalendarId: string;
    externalEventId: string;
  }): Promise<void> {
    const response = await fetch(`${GRAPH}/me/events/${encodeURIComponent(input.externalEventId)}`, {
      method: 'DELETE',
      headers: this.headers(input.accessToken),
    });
    if (!response.ok && response.status !== 404) {
      throw new IntegrationError(`Microsoft Graph delete failed (${response.status})`, 'PROVIDER_REQUEST_FAILED');
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<RefreshedToken> {
    const { clientId, clientSecret, tenantId } = this.config.oauth.microsoft;
    if (!clientId || !clientSecret) {
      throw new IntegrationError('Microsoft OAuth is not configured on this server', 'OAUTH_NOT_CONFIGURED');
    }

    const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'offline_access Calendars.ReadWrite',
      }),
    });
    if (!response.ok) {
      this.logger.warn(`Microsoft token refresh failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
      throw new IntegrationError('Microsoft refused to refresh the access token', 'TOKEN_REFRESH_FAILED');
    }

    const payload = (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : undefined,
    };
  }

  private initialDeltaUrl(): string {
    const now = Date.now();
    const params = new URLSearchParams({
      startDateTime: new Date(now - FULL_SYNC_PAST_DAYS * 86_400_000).toISOString(),
      endDateTime: new Date(now + FULL_SYNC_FUTURE_DAYS * 86_400_000).toISOString(),
      $select: 'id,subject,bodyPreview,start,end,isAllDay,location,lastModifiedDateTime,changeKey',
      $top: '100',
    });
    return `${GRAPH}/me/calendarView/delta?${params.toString()}`;
  }

  private headers(accessToken: string): Record<string, string> {
    return {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
      // Times come back in UTC so the engine never has to resolve zones.
      prefer: 'outlook.timezone="UTC"',
    };
  }

  private mapEvent(item: GraphEvent): ExternalCalendarEvent | null {
    if (!item.id) return null;
    const startAt = parseGraphDate(item.start?.dateTime);
    const endAt = parseGraphDate(item.end?.dateTime);
    if (!startAt) return null;

    return {
      externalId: item.id,
      etag: item['@odata.etag'] ?? item.changeKey ?? null,
      title: item.subject ?? '(untitled)',
      description: item.bodyPreview ?? item.body?.content ?? null,
      location: item.location?.displayName ?? null,
      startAt,
      endAt: endAt ?? new Date(startAt.getTime() + 3_600_000),
      allDay: item.isAllDay ?? false,
      cancelled: Boolean(item['@removed']),
      updatedAt: item.lastModifiedDateTime ? parseGraphDate(item.lastModifiedDateTime) : null,
    };
  }

  private eventBody(event: PushEventInput) {
    return {
      subject: event.title,
      body: event.description ? { contentType: 'text', content: event.description } : undefined,
      location: event.location ? { displayName: event.location } : undefined,
      start: graphBodyDate(event.startAt),
      end: graphBodyDate(event.endAt),
      isAllDay: event.allDay,
    };
  }
}

/** Graph returns 7-digit fractional seconds; V8 only parses up to milliseconds. */
function parseGraphDate(value?: string): Date | null {
  if (!value) return null;
  let normalized = value.trim();
  if (!/(z|[+-]\d{2}:?\d{2})$/i.test(normalized)) normalized = `${normalized}Z`;
  normalized = normalized.replace(/(\.\d{3})\d+/, '$1');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function graphBodyDate(date: Date) {
  return { dateTime: date.toISOString().replace('Z', ''), timeZone: 'UTC' };
}
