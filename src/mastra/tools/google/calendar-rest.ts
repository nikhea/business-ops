import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { googleRequest, type GoogleToolContext } from "./google-auth";

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

const DEFAULT_TIME_ZONE = process.env.GOOGLE_CALENDAR_TIMEZONE?.trim() || "UTC";
const DEFAULT_CALENDAR_ID = process.env.GOOGLE_DEFAULT_CALENDAR_ID?.trim() || "primary";

interface GoogleEventDate {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface GoogleAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
}

interface GoogleCalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: GoogleEventDate;
  end?: GoogleEventDate;
  attendees?: GoogleAttendee[];
  organizer?: { email?: string; displayName?: string };
  hangoutLink?: string;
  recurringEventId?: string;
  conferenceData?: {
    entryPoints?: { uri?: string; entryPointType?: string }[];
  };
}

interface NormalizedEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start: string;
  end: string;
  timeZone?: string;
  allDay: boolean;
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
  organizer?: { email?: string; displayName?: string };
  meetLink?: string;
  recurringEventId?: string;
}

function toEventDate(value: string, timeZone: string): GoogleEventDate {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: value };
  return { dateTime: value, timeZone };
}

function isAllDay(date: GoogleEventDate | undefined): boolean {
  return Boolean(date?.date) && !date?.dateTime;
}

function normalizeEvent(event: GoogleCalendarEvent): NormalizedEvent {
  const meetLink =
    event.hangoutLink ??
    event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri;

  const attendees = event.attendees
    ?.filter((attendee): attendee is GoogleAttendee & { email: string } => Boolean(attendee.email))
    .map((attendee) => ({
      email: attendee.email,
      displayName: attendee.displayName,
      responseStatus: attendee.responseStatus,
    }));

  return {
    id: event.id,
    status: event.status,
    summary: event.summary,
    description: event.description,
    location: event.location,
    htmlLink: event.htmlLink,
    start: event.start?.dateTime ?? event.start?.date ?? "",
    end: event.end?.dateTime ?? event.end?.date ?? "",
    timeZone: event.start?.timeZone,
    allDay: isAllDay(event.start),
    attendees: attendees && attendees.length > 0 ? attendees : undefined,
    organizer: event.organizer,
    meetLink,
    recurringEventId: event.recurringEventId,
  };
}

const eventSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  htmlLink: z.string().optional(),
  start: z.string(),
  end: z.string(),
  timeZone: z.string().optional(),
  allDay: z.boolean(),
  attendees: z
    .array(
      z.object({
        email: z.string(),
        displayName: z.string().optional(),
        responseStatus: z.string().optional(),
      }),
    )
    .optional(),
  organizer: z
    .object({
      email: z.string().optional(),
      displayName: z.string().optional(),
    })
    .optional(),
  meetLink: z.string().optional(),
  recurringEventId: z.string().optional(),
});

const sendUpdatesSchema = z
  .enum(["all", "externalOnly", "none"])
  .default("none")
  .describe("Who receives update notifications: all attendees, external only, or nobody");

export const calendarListCalendarsTool = createTool({
  id: "calendar_list_calendars",
  title: "Calendar: list calendars",
  description:
    "List the calendars visible to the authenticated user with their IDs, names, access roles and time zones. Use the returned IDs with the other calendar tools.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    calendars: z.array(
      z.object({
        id: z.string(),
        summary: z.string().optional(),
        description: z.string().optional(),
        primary: z.boolean().optional(),
        accessRole: z.string().optional(),
        timeZone: z.string().optional(),
      }),
    ),
  }),
  execute: async (_input, { requestContext }) => {
    const response = await googleRequest<{
      items?: {
        id: string;
        summary?: string;
        description?: string;
        primary?: boolean;
        accessRole?: string;
        timeZone?: string;
      }[];
    }>(`${CALENDAR_BASE}/users/me/calendarList`, { authContext: { requestContext } });

    return { calendars: response.items ?? [] };
  },
});

export const calendarListEventsTool = createTool({
  id: "calendar_list_events",
  title: "Calendar: list events",
  description:
    "List events on a calendar within a time range. Use ISO 8601 timestamps for `timeMin`/`timeMax`. Supports free-text search with `query`.",
  inputSchema: z.object({
    calendarId: z.string().default(DEFAULT_CALENDAR_ID).describe("Calendar ID, defaults to the primary calendar"),
    timeMin: z.string().optional().describe("Start of the range, ISO 8601, e.g. 2026-10-01T00:00:00Z"),
    timeMax: z.string().optional().describe("End of the range, ISO 8601"),
    query: z.string().optional().describe("Free-text search across event fields"),
    maxResults: z.number().int().min(1).max(250).default(25).describe("Maximum events to return"),
    singleEvents: z.boolean().default(true).describe("Expand recurring events into individual instances"),
    orderBy: z.enum(["startTime", "updated"]).default("startTime").describe("Sort order"),
    pageToken: z.string().optional().describe("Token from a previous response for pagination"),
  }),
  outputSchema: z.object({
    events: z.array(eventSchema),
    nextPageToken: z.string().optional(),
  }),
  execute: async (
    { calendarId, timeMin, timeMax, query, maxResults, singleEvents, orderBy, pageToken },
    { requestContext },
  ) => {
    const response = await googleRequest<{ items?: GoogleCalendarEvent[]; nextPageToken?: string }>(
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        query: {
          timeMin,
          timeMax,
          q: query,
          maxResults,
          singleEvents,
          orderBy: singleEvents ? orderBy : undefined,
          pageToken,
        },
        authContext: { requestContext },
      },
    );

    return {
      events: (response.items ?? []).map(normalizeEvent),
      nextPageToken: response.nextPageToken,
    };
  },
});

export const calendarCreateEventTool = createTool({
  id: "calendar_create_event",
  title: "Calendar: create event",
  description:
    "Create a calendar event. Use a date (YYYY-MM-DD) for all-day events, or an ISO 8601 date-time with an offset for timed events. Can optionally add a Google Meet link and invite attendees.",
  inputSchema: z.object({
    calendarId: z.string().default(DEFAULT_CALENDAR_ID).describe("Calendar ID to create the event on"),
    summary: z.string().describe("Event title"),
    description: z.string().optional().describe("Event description or agenda"),
    location: z.string().optional().describe("Event location"),
    start: z.string().describe("Start: YYYY-MM-DD for all-day, or ISO 8601 date-time"),
    end: z.string().describe("End: YYYY-MM-DD for all-day, or ISO 8601 date-time"),
    timeZone: z.string().default(DEFAULT_TIME_ZONE).describe("IANA time zone for date-times"),
    attendees: z.array(z.string()).optional().describe("Attendee email addresses"),
    addMeetLink: z.boolean().default(false).describe("Attach a Google Meet conference link"),
    sendUpdates: sendUpdatesSchema,
  }),
  outputSchema: eventSchema,
  execute: async (
    { calendarId, summary, description, location, start, end, timeZone, attendees, addMeetLink, sendUpdates },
    { requestContext },
  ) => {
    const body: Record<string, unknown> = {
      summary,
      start: toEventDate(start, timeZone),
      end: toEventDate(end, timeZone),
    };

    if (description) body.description = description;
    if (location) body.location = location;
    if (attendees && attendees.length > 0) body.attendees = attendees.map((email) => ({ email }));

    if (addMeetLink) {
      body.conferenceData = {
        createRequest: {
          requestId: randomUUID(),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };
    }

    const created = await googleRequest<GoogleCalendarEvent>(
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        query: { sendUpdates, conferenceDataVersion: addMeetLink ? 1 : undefined },
        json: body,
        authContext: { requestContext },
      },
    );

    return normalizeEvent(created);
  },
});

export const calendarUpdateEventTool = createTool({
  id: "calendar_update_event",
  title: "Calendar: update event",
  description:
    "Update fields on an existing event. Only the fields you provide are changed. Pass `attendees` to replace the attendee list.",
  inputSchema: z.object({
    calendarId: z.string().default(DEFAULT_CALENDAR_ID).describe("Calendar ID"),
    eventId: z.string().describe("Event ID"),
    summary: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    location: z.string().optional().describe("New location"),
    start: z.string().optional().describe("New start (YYYY-MM-DD or ISO 8601 date-time)"),
    end: z.string().optional().describe("New end (YYYY-MM-DD or ISO 8601 date-time)"),
    timeZone: z.string().default(DEFAULT_TIME_ZONE).describe("IANA time zone for date-times"),
    attendees: z.array(z.string()).optional().describe("Replacement attendee email addresses"),
    sendUpdates: sendUpdatesSchema,
  }),
  outputSchema: eventSchema,
  execute: async (
    { calendarId, eventId, summary, description, location, start, end, timeZone, attendees, sendUpdates },
    { requestContext },
  ) => {
    const body: Record<string, unknown> = {};

    if (summary !== undefined) body.summary = summary;
    if (description !== undefined) body.description = description;
    if (location !== undefined) body.location = location;
    if (start !== undefined) body.start = toEventDate(start, timeZone);
    if (end !== undefined) body.end = toEventDate(end, timeZone);
    if (attendees !== undefined) body.attendees = attendees.map((email) => ({ email }));

    if (Object.keys(body).length === 0) {
      throw new Error("No fields to update were provided.");
    }

    const updated = await googleRequest<GoogleCalendarEvent>(
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: "PATCH",
        query: { sendUpdates },
        json: body,
        authContext: { requestContext },
      },
    );

    return normalizeEvent(updated);
  },
});

export const calendarDeleteEventTool = createTool({
  id: "calendar_delete_event",
  title: "Calendar: delete event",
  description: "Permanently delete an event from a calendar.",
  inputSchema: z.object({
    calendarId: z.string().default(DEFAULT_CALENDAR_ID).describe("Calendar ID"),
    eventId: z.string().describe("Event ID"),
    sendUpdates: sendUpdatesSchema,
  }),
  outputSchema: z.object({
    deleted: z.boolean(),
    eventId: z.string(),
  }),
  execute: async ({ calendarId, eventId, sendUpdates }, { requestContext }) => {
    await googleRequest<void>(
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE", query: { sendUpdates }, authContext: { requestContext } },
    );

    return { deleted: true, eventId };
  },
});

interface Interval {
  start: number;
  end: number;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];

  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }

  return merged;
}

function subtractIntervals(window: Interval, busy: Interval[]): Interval[] {
  const free: Interval[] = [];
  let cursor = window.start;

  for (const interval of busy) {
    if (interval.end <= cursor) continue;
    if (interval.start >= window.end) break;
    if (interval.start > cursor) free.push({ start: cursor, end: Math.min(interval.start, window.end) });
    cursor = Math.max(cursor, interval.end);
    if (cursor >= window.end) break;
  }

  if (cursor < window.end) free.push({ start: cursor, end: window.end });
  return free;
}

function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const result: Interval[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (start < end) result.push({ start, end });
    if (a[i].end < b[j].end) i++;
    else j++;
  }

  return result;
}

export const calendarFindFreeSlotsTool = createTool({
  id: "calendar_find_free_slots",
  title: "Calendar: find free slots",
  description:
    "Find time windows when every listed calendar is free. Uses the free/busy API and returns the intersection of free time, longest windows first. Useful for scheduling meetings.",
  inputSchema: z.object({
    calendarIds: z
      .array(z.string())
      .default([DEFAULT_CALENDAR_ID])
      .describe("Calendars that all need to be free, e.g. ['primary', 'teammate@example.com']"),
    timeMin: z.string().describe("Start of the search window, ISO 8601"),
    timeMax: z.string().describe("End of the search window, ISO 8601"),
    durationMinutes: z.number().int().min(1).default(30).describe("Minimum slot length in minutes"),
    maxSlots: z.number().int().min(1).max(50).default(10).describe("Maximum number of slots to return"),
    timeZone: z.string().default(DEFAULT_TIME_ZONE).describe("IANA time zone for the free/busy query"),
  }),
  outputSchema: z.object({
    slots: z.array(
      z.object({
        start: z.string(),
        end: z.string(),
        durationMinutes: z.number(),
      }),
    ),
    freeBusy: z.record(
      z.string(),
      z.array(z.object({ start: z.string(), end: z.string() })),
    ),
  }),
  execute: async ({ calendarIds, timeMin, timeMax, durationMinutes, maxSlots, timeZone }, { requestContext }) => {
    const context: GoogleToolContext = { requestContext };
    const windowStart = new Date(timeMin).getTime();
    const windowEnd = new Date(timeMax).getTime();

    if (Number.isNaN(windowStart) || Number.isNaN(windowEnd) || windowStart >= windowEnd) {
      throw new Error("Invalid time range: pass ISO 8601 timestamps with timeMin before timeMax.");
    }

    const response = await googleRequest<{
      calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
    }>(`${CALENDAR_BASE}/freeBusy`, {
      method: "POST",
      json: {
        timeMin: new Date(windowStart).toISOString(),
        timeMax: new Date(windowEnd).toISOString(),
        timeZone,
        items: calendarIds.map((id) => ({ id })),
      },
      authContext: context,
    });

    const freeBusy: Record<string, Interval[]> = {};
    for (const calendarId of calendarIds) {
      const busy = (response.calendars?.[calendarId]?.busy ?? []).map((slot) => ({
        start: new Date(slot.start).getTime(),
        end: new Date(slot.end).getTime(),
      }));
      freeBusy[calendarId] = mergeIntervals(busy);
    }

    let free: Interval[] = [{ start: windowStart, end: windowEnd }];
    for (const calendarId of calendarIds) {
      const calendarFree = subtractIntervals({ start: windowStart, end: windowEnd }, freeBusy[calendarId] ?? []);
      free = intersectIntervals(free, calendarFree);
    }

    const minimumMs = durationMinutes * 60_000;
    const slots = free
      .filter((interval) => interval.end - interval.start >= minimumMs)
      .sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)
      .slice(0, maxSlots)
      .map((interval) => ({
        start: new Date(interval.start).toISOString(),
        end: new Date(interval.end).toISOString(),
        durationMinutes: Math.floor((interval.end - interval.start) / 60_000),
      }));

    return {
      slots,
      freeBusy: Object.fromEntries(
        Object.entries(freeBusy).map(([calendarId, intervals]) => [
          calendarId,
          intervals.map((interval) => ({
            start: new Date(interval.start).toISOString(),
            end: new Date(interval.end).toISOString(),
          })),
        ]),
      ),
    };
  },
});

export const calendarTools = {
  calendarListCalendarsTool,
  calendarListEventsTool,
  calendarCreateEventTool,
  calendarUpdateEventTool,
  calendarDeleteEventTool,
  calendarFindFreeSlotsTool,
};
