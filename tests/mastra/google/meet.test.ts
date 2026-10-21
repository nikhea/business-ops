import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockGoogleFetch } from "../../helpers/http";
import { resetFakeGoogleStore } from "../../helpers/fake-google-redis";
import { runTool } from "../../helpers/tool";
import { meetTools } from "../../../src/mastra/tools/google/meet-rest";

vi.mock("../../../src/mastra/tools/google/google-redis", () => import("../../helpers/fake-google-redis"));

const context = { requestContext: { get: () => undefined } } as never;

const space = {
  name: "spaces/abc-defg-hij",
  meetingUri: "https://meet.google.com/abc-defg-hij",
  meetingCode: "abc-defg-hij",
  config: { accessType: "OPEN", entryPointAccess: "ALL", moderation: "OFF" },
};

describe("meet tools", () => {
  beforeEach(() => {
    resetFakeGoogleStore();
    process.env.GOOGLE_ACCESS_TOKEN = "test-access-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a space with config", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse(space));

    const result = await runTool(meetTools.meetCreateSpaceTool, {
      accessType: "OPEN",
      entryPointAccess: "ALL",
      moderation: "OFF",
    });

    expect(result).toEqual({
      name: "spaces/abc-defg-hij",
      meetingUri: "https://meet.google.com/abc-defg-hij",
      meetingCode: "abc-defg-hij",
      accessType: "OPEN",
      entryPointAccess: "ALL",
      moderation: "OFF",
      activeConferenceRecord: undefined,
    });

    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.pathname).toBe("/v2/spaces");
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({
      config: { accessType: "OPEN", entryPointAccess: "ALL", moderation: "OFF" },
    });
  });

  it("creates a space with defaults when no settings are given", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse(space));

    await runTool(meetTools.meetCreateSpaceTool, {});

    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({});
  });

  it("gets a space by meeting code", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({
        ...space,
        activeConference: { conferenceRecord: "conferenceRecords/rec1" },
      }),
    );

    const result = await runTool(meetTools.meetGetSpaceTool, { space: "abc-defg-hij" });

    expect(calls[0].url.pathname).toBe("/v2/spaces/abc-defg-hij");
    expect(result.activeConferenceRecord).toBe("conferenceRecords/rec1");
  });

  it("keeps full space resource names intact", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse(space));

    await runTool(meetTools.meetGetSpaceTool, { space: "spaces/jQCFfuBOdN5z" });

    expect(calls[0].url.pathname).toBe("/v2/spaces/jQCFfuBOdN5z");
  });

  it("patches only the provided settings", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ ...space, config: { accessType: "TRUSTED", entryPointAccess: "CREATOR_APP_ONLY" } }),
    );

    const result = await runTool(meetTools.meetUpdateSpaceTool, {
      space: "abc-defg-hij",
      accessType: "TRUSTED",
      entryPointAccess: "CREATOR_APP_ONLY",
    });

    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url.searchParams.get("updateMask")).toBe(
      "config.accessType,config.entryPointAccess",
    );
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({
      config: { accessType: "TRUSTED", entryPointAccess: "CREATOR_APP_ONLY" },
    });
    expect(result.accessType).toBe("TRUSTED");
  });

  it("rejects updates without any settings", async () => {
    mockGoogleFetch(() => jsonResponse(space));

    await expect(runTool(meetTools.meetUpdateSpaceTool, { space: "abc-defg-hij" })).rejects.toThrow(
      "Provide at least one of accessType, entryPointAccess, or moderation.",
    );
  });

  it("ends the active conference", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse({}));

    const result = await runTool(meetTools.meetEndActiveConferenceTool, { space: "abc-defg-hij" });

    expect(result).toEqual({ space: "spaces/abc-defg-hij", ended: true });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.pathname).toBe("/v2/spaces/abc-defg-hij:endActiveConference");
  });

  it("lists conference records with filters", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({
        conferenceRecords: [
          {
            name: "conferenceRecords/rec1",
            space: "spaces/abc-defg-hij",
            startTime: "2026-10-20T09:00:00Z",
            endTime: "2026-10-20T09:30:00Z",
            expireTime: "2026-11-19T09:30:00Z",
          },
        ],
        nextPageToken: "next",
      }),
    );

    const result = await runTool(meetTools.meetListConferenceRecordsTool, {
      pageSize: 25,
      space: "abc-defg-hij",
      meetingCode: "abc-defg-hij",
      startTimeFrom: "2026-10-01T00:00:00Z",
      startTimeTo: "2026-10-31T23:59:59Z",
    });

    expect(result).toEqual({
      conferenceRecords: [
        {
          name: "conferenceRecords/rec1",
          space: "spaces/abc-defg-hij",
          startTime: "2026-10-20T09:00:00Z",
          endTime: "2026-10-20T09:30:00Z",
          expireTime: "2026-11-19T09:30:00Z",
        },
      ],
      nextPageToken: "next",
    });

    expect(calls[0].url.pathname).toBe("/v2/conferenceRecords");
    expect(calls[0].url.searchParams.get("filter")).toBe(
      'space.name = "spaces/abc-defg-hij" AND space.meeting_code = "abc-defg-hij" AND ' +
        'start_time >= "2026-10-01T00:00:00Z" AND start_time <= "2026-10-31T23:59:59Z"',
    );
  });

  it("lists participants across user kinds", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({
        participants: [
          {
            name: "conferenceRecords/rec1/participants/p1",
            earliestStartTime: "2026-10-20T09:00:00Z",
            latestEndTime: "2026-10-20T09:30:00Z",
            signedinUser: { user: "users/123", displayName: "Ada Lovelace" },
          },
          {
            name: "conferenceRecords/rec1/participants/p2",
            anonymousUser: { displayName: "Guest" },
          },
          {
            name: "conferenceRecords/rec1/participants/p3",
            phoneUser: { displayName: "+1 ***-***-1234" },
          },
        ],
      }),
    );

    const result = await runTool(meetTools.meetListParticipantsTool, {
      conferenceRecord: "rec1",
      pageSize: 100,
    });

    expect(calls[0].url.pathname).toBe("/v2/conferenceRecords/rec1/participants");
    expect(result.participants).toEqual([
      {
        name: "conferenceRecords/rec1/participants/p1",
        displayName: "Ada Lovelace",
        user: "users/123",
        kind: "signedin",
        earliestStartTime: "2026-10-20T09:00:00Z",
        latestEndTime: "2026-10-20T09:30:00Z",
      },
      {
        name: "conferenceRecords/rec1/participants/p2",
        displayName: "Guest",
        kind: "anonymous",
        earliestStartTime: undefined,
        latestEndTime: undefined,
      },
      {
        name: "conferenceRecords/rec1/participants/p3",
        displayName: "+1 ***-***-1234",
        kind: "phone",
        earliestStartTime: undefined,
        latestEndTime: undefined,
      },
    ]);
  });

  it("lists recordings and transcripts with Drive and Docs destinations", async () => {
    const { calls } = mockGoogleFetch(({ url }) => {
      if (url.pathname.endsWith("/recordings")) {
        return jsonResponse({
          recordings: [
            {
              name: "conferenceRecords/rec1/recordings/r1",
              state: "FILE_GENERATED",
              startTime: "2026-10-20T09:00:00Z",
              endTime: "2026-10-20T09:30:00Z",
              driveDestination: {
                file: "drive-file-1",
                exportUri: "https://drive.google.com/file/d/drive-file-1/view",
              },
            },
          ],
        });
      }

      if (url.pathname.endsWith("/transcripts")) {
        return jsonResponse({
          transcripts: [
            {
              name: "conferenceRecords/rec1/transcripts/t1",
              state: "FILE_GENERATED",
              docsDestination: {
                document: "doc-1",
                exportUri: "https://docs.google.com/document/d/doc-1/edit",
              },
            },
          ],
        });
      }

      return jsonResponse({ error: { message: "unexpected" } }, 404);
    });

    const recordings = await runTool(meetTools.meetListRecordingsTool, {
      conferenceRecord: "conferenceRecords/rec1",
      pageSize: 10,
    });

    expect(recordings.recordings[0]).toEqual({
      name: "conferenceRecords/rec1/recordings/r1",
      state: "FILE_GENERATED",
      startTime: "2026-10-20T09:00:00Z",
      endTime: "2026-10-20T09:30:00Z",
      driveFileId: "drive-file-1",
      exportUri: "https://drive.google.com/file/d/drive-file-1/view",
    });

    const transcripts = await runTool(meetTools.meetListTranscriptsTool, {
      conferenceRecord: "rec1",
      pageSize: 10,
    });

    expect(transcripts.transcripts[0]).toEqual({
      name: "conferenceRecords/rec1/transcripts/t1",
      state: "FILE_GENERATED",
      startTime: undefined,
      endTime: undefined,
      documentId: "doc-1",
      exportUri: "https://docs.google.com/document/d/doc-1/edit",
    });

    expect(calls[0].url.pathname).toBe("/v2/conferenceRecords/rec1/recordings");
    expect(calls[1].url.pathname).toBe("/v2/conferenceRecords/rec1/transcripts");
  });

  it("lists transcript entries for a transcript", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({
        entries: [
          {
            name: "conferenceRecords/rec1/transcripts/t1/entries/e1",
            participant: "conferenceRecords/rec1/participants/p1",
            text: "Hello everyone",
            languageCode: "en-US",
            startTime: "2026-10-20T09:01:00Z",
            endTime: "2026-10-20T09:01:05Z",
          },
        ],
      }),
    );

    const result = await runTool(meetTools.meetListTranscriptEntriesTool, {
      conferenceRecord: "rec1",
      transcript: "transcripts/t1",
      pageSize: 10,
    });

    expect(calls[0].url.pathname).toBe("/v2/conferenceRecords/rec1/transcripts/t1/entries");
    expect(result.entries).toEqual([
      {
        name: "conferenceRecords/rec1/transcripts/t1/entries/e1",
        participant: "conferenceRecords/rec1/participants/p1",
        text: "Hello everyone",
        languageCode: "en-US",
        startTime: "2026-10-20T09:01:00Z",
        endTime: "2026-10-20T09:01:05Z",
      },
    ]);
  });
});
