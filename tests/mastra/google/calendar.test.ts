import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockGoogleFetch } from "../../helpers/http";
import { resetFakeGoogleStore } from "../../helpers/fake-google-store";
import { runTool } from "../../helpers/tool";
import { calendarTools } from "../../../src/mastra/tools/google/calendar-rest";

vi.mock("../../../src/mastra/tools/google/google-store", () => import("../../helpers/fake-google-store"));

const context = { requestContext: { get: () => undefined } } as never;

describe("calendar tools", () => {
  beforeEach(() => {
    resetFakeGoogleStore();
    process.env.GOOGLE_ACCESS_TOKEN = "test-access-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes timed and all-day events", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({
        items: [
          {
            id: "e1",
            status: "confirmed",
            summary: "Standup",
            start: { dateTime: "2026-10-22T09:00:00Z", timeZone: "UTC" },
            end: { dateTime: "2026-10-22T09:30:00Z", timeZone: "UTC" },
            attendees: [{ email: "alice@example.com", responseStatus: "accepted" }, { displayName: "No Email" }],
            hangoutLink: "https://meet.google.com/abc-defg-hij",
          },
          {
            id: "e2",
            summary: "Holiday",
            start: { date: "2026-10-23" },
            end: { date: "2026-10-24" },
          },
        ],
      }),
    );

    const result = await runTool(calendarTools.calendarListEventsTool, 
      {
        calendarId: "team@example.com",
        timeMin: "2026-10-01T00:00:00Z",
        timeMax: "2026-11-01T00:00:00Z",
        maxResults: 10,
        singleEvents: true,
        orderBy: "startTime",
      },
      context,
    );

    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      id: "e1",
      summary: "Standup",
      start: "2026-10-22T09:00:00Z",
      end: "2026-10-22T09:30:00Z",
      allDay: false,
      meetLink: "https://meet.google.com/abc-defg-hij",
      attendees: [{ email: "alice@example.com", responseStatus: "accepted" }],
    });
    expect(result.events[1]).toMatchObject({ id: "e2", start: "2026-10-23", end: "2026-10-24", allDay: true });

    const listCall = calls[0];
    expect(listCall.url.pathname).toBe("/calendar/v3/calendars/team%40example.com/events");
    expect(listCall.url.searchParams.get("q")).toBeNull();
    expect(listCall.url.searchParams.get("singleEvents")).toBe("true");
    expect(listCall.url.searchParams.get("orderBy")).toBe("startTime");
  });

  it("creates a timed event with a Meet link", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({
        id: "new1",
        summary: "Sync",
        start: { dateTime: "2026-10-22T12:00:00Z", timeZone: "UTC" },
        end: { dateTime: "2026-10-22T12:30:00Z", timeZone: "UTC" },
        hangoutLink: "https://meet.google.com/new-link",
      }),
    );

    const event = await runTool(calendarTools.calendarCreateEventTool, 
      {
        calendarId: "primary",
        summary: "Sync",
        description: "Weekly sync",
        start: "2026-10-22T12:00:00Z",
        end: "2026-10-22T12:30:00Z",
        timeZone: "UTC",
        attendees: ["alice@example.com"],
        addMeetLink: true,
        sendUpdates: "none",
      },
      context,
    );

    expect(event.meetLink).toBe("https://meet.google.com/new-link");

    const body = JSON.parse(calls[0].body ?? "{}");
    expect(body.summary).toBe("Sync");
    expect(body.start).toEqual({ dateTime: "2026-10-22T12:00:00Z", timeZone: "UTC" });
    expect(body.attendees).toEqual([{ email: "alice@example.com" }]);
    expect(body.conferenceData.createRequest.conferenceSolutionKey).toEqual({ type: "hangoutsMeet" });
    expect(typeof body.conferenceData.createRequest.requestId).toBe("string");
    expect(calls[0].url.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(calls[0].url.searchParams.get("sendUpdates")).toBe("none");
  });

  it("creates all-day events using date fields", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({
        id: "all1",
        summary: "Offsite",
        start: { date: "2026-11-01" },
        end: { date: "2026-11-02" },
      }),
    );

    const event = await runTool(calendarTools.calendarCreateEventTool, 
      {
        calendarId: "primary",
        summary: "Offsite",
        start: "2026-11-01",
        end: "2026-11-02",
        timeZone: "UTC",
        addMeetLink: false,
        sendUpdates: "none",
      },
      context,
    );

    expect(event.allDay).toBe(true);

    const body = JSON.parse(calls[0].body ?? "{}");
    expect(body.start).toEqual({ date: "2026-11-01" });
    expect(body.end).toEqual({ date: "2026-11-02" });
    expect(body.conferenceData).toBeUndefined();
    expect(calls[0].url.searchParams.get("conferenceDataVersion")).toBeNull();
  });

  it("patches only the supplied fields and rejects empty updates", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({
        id: "e1",
        summary: "Renamed",
        start: { dateTime: "2026-10-22T09:00:00Z", timeZone: "UTC" },
        end: { dateTime: "2026-10-22T09:30:00Z", timeZone: "UTC" },
      }),
    );

    const updated = await runTool(calendarTools.calendarUpdateEventTool, 
      { calendarId: "primary", eventId: "e1", summary: "Renamed", sendUpdates: "none" },
      context,
    );

    expect(updated.summary).toBe("Renamed");
    expect(calls[0].method).toBe("PATCH");
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({ summary: "Renamed" });

    await expect(
      runTool(calendarTools.calendarUpdateEventTool, { calendarId: "primary", eventId: "e1", sendUpdates: "none" }, context),
    ).rejects.toThrow("No fields to update were provided.");
  });

  it("deletes events", async () => {
    const { calls } = mockGoogleFetch(() => new Response(null, { status: 204 }));

    const result = await runTool(calendarTools.calendarDeleteEventTool, 
      { calendarId: "primary", eventId: "e1", sendUpdates: "all" },
      context,
    );

    expect(result).toEqual({ deleted: true, eventId: "e1" });
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url.searchParams.get("sendUpdates")).toBe("all");
  });

  it("intersects free/busy windows across calendars", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({
        calendars: {
          primary: { busy: [{ start: "2026-10-22T10:00:00Z", end: "2026-10-22T11:00:00Z" }] },
          "team@example.com": { busy: [{ start: "2026-10-22T09:30:00Z", end: "2026-10-22T10:30:00Z" }] },
        },
      }),
    );

    const result = await runTool(calendarTools.calendarFindFreeSlotsTool, 
      {
        calendarIds: ["primary", "team@example.com"],
        timeMin: "2026-10-22T09:00:00Z",
        timeMax: "2026-10-22T12:00:00Z",
        durationMinutes: 30,
        maxSlots: 10,
        timeZone: "UTC",
      },
      context,
    );

    expect(result.slots).toEqual([
      { start: "2026-10-22T11:00:00.000Z", end: "2026-10-22T12:00:00.000Z", durationMinutes: 60 },
      { start: "2026-10-22T09:00:00.000Z", end: "2026-10-22T09:30:00.000Z", durationMinutes: 30 },
    ]);
    expect(calls[0].url.pathname).toBe("/calendar/v3/freeBusy");
    expect(JSON.parse(calls[0].body ?? "{}").items).toEqual([
      { id: "primary" },
      { id: "team@example.com" },
    ]);
  });

  it("rejects invalid free/busy windows", async () => {
    mockGoogleFetch(() => jsonResponse({ calendars: {} }));

    await expect(
      runTool(calendarTools.calendarFindFreeSlotsTool, 
        {
          calendarIds: ["primary"],
          timeMin: "2026-10-23T00:00:00Z",
          timeMax: "2026-10-22T00:00:00Z",
          durationMinutes: 30,
          maxSlots: 10,
          timeZone: "UTC",
        },
        context,
      ),
    ).rejects.toThrow("Invalid time range");
  });

  it("lists calendars with access roles", async () => {
    mockGoogleFetch(() =>
      jsonResponse({
        items: [
          { id: "primary", summary: "Me", primary: true, accessRole: "owner", timeZone: "UTC" },
          { id: "team@example.com", summary: "Team", accessRole: "reader" },
        ],
      }),
    );

    const result = await runTool(calendarTools.calendarListCalendarsTool, {}, context);

    expect(result.calendars).toEqual([
      { id: "primary", summary: "Me", primary: true, accessRole: "owner", timeZone: "UTC" },
      { id: "team@example.com", summary: "Team", accessRole: "reader" },
    ]);
  });
});
