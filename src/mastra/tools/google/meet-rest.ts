import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { googleRequest } from "./google-auth";

const MEET_BASE = "https://meet.googleapis.com/v2";

const ACCESS_TYPES = ["OPEN", "TRUSTED", "RESTRICTED"] as const;
const ENTRY_POINT_ACCESS = ["ALL", "CREATOR_APP_ONLY"] as const;
const MODERATION = ["ON", "OFF"] as const;

interface MeetSpace {
  name: string;
  meetingUri?: string;
  meetingCode?: string;
  config?: {
    accessType?: string;
    entryPointAccess?: string;
    moderation?: string;
  };
  activeConference?: { conferenceRecord?: string };
}

interface MeetConferenceRecord {
  name: string;
  startTime?: string;
  endTime?: string;
  expireTime?: string;
  space?: string;
}

interface MeetParticipant {
  name: string;
  earliestStartTime?: string;
  latestEndTime?: string;
  signedinUser?: { user?: string; displayName?: string };
  anonymousUser?: { displayName?: string };
  phoneUser?: { displayName?: string };
}

interface MeetRecording {
  name: string;
  state?: string;
  startTime?: string;
  endTime?: string;
  driveDestination?: { file?: string; exportUri?: string };
}

interface MeetTranscript {
  name: string;
  state?: string;
  startTime?: string;
  endTime?: string;
  docsDestination?: { document?: string; exportUri?: string };
}

interface MeetTranscriptEntry {
  name: string;
  participant?: string;
  text?: string;
  languageCode?: string;
  startTime?: string;
  endTime?: string;
}

interface MeetListResponse<T> {
  nextPageToken?: string;
  [key: string]: unknown;
  // Populated per resource by the API.
  spaces?: T[];
  conferenceRecords?: T[];
  participants?: T[];
  recordings?: T[];
  transcripts?: T[];
  entries?: T[];
}

const spaceSchema = z.object({
  name: z.string(),
  meetingUri: z.string().optional(),
  meetingCode: z.string().optional(),
  accessType: z.string().optional(),
  entryPointAccess: z.string().optional(),
  moderation: z.string().optional(),
  activeConferenceRecord: z.string().optional(),
});

const conferenceRecordSchema = z.object({
  name: z.string(),
  space: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  expireTime: z.string().optional(),
});

const participantSchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  user: z.string().optional(),
  kind: z.enum(["signedin", "anonymous", "phone", "unknown"]),
  earliestStartTime: z.string().optional(),
  latestEndTime: z.string().optional(),
});

const recordingSchema = z.object({
  name: z.string(),
  state: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  driveFileId: z.string().optional(),
  exportUri: z.string().optional(),
});

const transcriptSchema = z.object({
  name: z.string(),
  state: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  documentId: z.string().optional(),
  exportUri: z.string().optional(),
});

const transcriptEntrySchema = z.object({
  name: z.string(),
  participant: z.string().optional(),
  text: z.string().optional(),
  languageCode: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

function normalizeSpaceName(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("spaces/") ? trimmed : `spaces/${trimmed}`;
}

function normalizeConferenceRecordName(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("conferenceRecords/") ? trimmed : `conferenceRecords/${trimmed}`;
}

function normalizeTranscriptName(conferenceRecord: string, transcript: string): string {
  const trimmed = transcript.trim();
  if (trimmed.startsWith("conferenceRecords/")) return trimmed;

  const record = normalizeConferenceRecordName(conferenceRecord);
  if (trimmed.startsWith("transcripts/")) return `${record}/${trimmed}`;
  return `${record}/transcripts/${trimmed}`;
}

/** Encodes a resource name as a URL path while keeping its `/` separators. */
function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""),
  ) as Partial<T>;
}

function mapSpace(space: MeetSpace) {
  return {
    name: space.name,
    meetingUri: space.meetingUri,
    meetingCode: space.meetingCode,
    accessType: space.config?.accessType,
    entryPointAccess: space.config?.entryPointAccess,
    moderation: space.config?.moderation,
    activeConferenceRecord: space.activeConference?.conferenceRecord,
  };
}

function mapConferenceRecord(record: MeetConferenceRecord) {
  return {
    name: record.name,
    space: record.space,
    startTime: record.startTime,
    endTime: record.endTime,
    expireTime: record.expireTime,
  };
}

function mapParticipant(participant: MeetParticipant) {
  if (participant.signedinUser) {
    return {
      name: participant.name,
      displayName: participant.signedinUser.displayName,
      user: participant.signedinUser.user,
      kind: "signedin" as const,
      earliestStartTime: participant.earliestStartTime,
      latestEndTime: participant.latestEndTime,
    };
  }

  if (participant.anonymousUser) {
    return {
      name: participant.name,
      displayName: participant.anonymousUser.displayName,
      kind: "anonymous" as const,
      earliestStartTime: participant.earliestStartTime,
      latestEndTime: participant.latestEndTime,
    };
  }

  if (participant.phoneUser) {
    return {
      name: participant.name,
      displayName: participant.phoneUser.displayName,
      kind: "phone" as const,
      earliestStartTime: participant.earliestStartTime,
      latestEndTime: participant.latestEndTime,
    };
  }

  return {
    name: participant.name,
    kind: "unknown" as const,
    earliestStartTime: participant.earliestStartTime,
    latestEndTime: participant.latestEndTime,
  };
}

function mapRecording(recording: MeetRecording) {
  return {
    name: recording.name,
    state: recording.state,
    startTime: recording.startTime,
    endTime: recording.endTime,
    driveFileId: recording.driveDestination?.file,
    exportUri: recording.driveDestination?.exportUri,
  };
}

function mapTranscript(transcript: MeetTranscript) {
  return {
    name: transcript.name,
    state: transcript.state,
    startTime: transcript.startTime,
    endTime: transcript.endTime,
    documentId: transcript.docsDestination?.document,
    exportUri: transcript.docsDestination?.exportUri,
  };
}

const spaceConfigInput = {
  accessType: z
    .enum(ACCESS_TYPES)
    .optional()
    .describe("Who can join without knocking: OPEN, TRUSTED, or RESTRICTED"),
  entryPointAccess: z
    .enum(ENTRY_POINT_ACCESS)
    .optional()
    .describe("Join entry points: ALL, or CREATOR_APP_ONLY for the creating Cloud project"),
  moderation: z.enum(MODERATION).optional().describe("Pre-configured moderation: ON or OFF"),
};

export const meetCreateSpaceTool = createTool({
  id: "meet_create_space",
  title: "Meet: create meeting space",
  description:
    "Create a Google Meet space and return its join URL, meeting code, and resource name. Optionally set access, entry point, and moderation settings.",
  inputSchema: z.object(spaceConfigInput),
  outputSchema: spaceSchema,
  execute: async ({ accessType, entryPointAccess, moderation }, { requestContext }) => {
    const config = compact({ accessType, entryPointAccess, moderation });

    const space = await googleRequest<MeetSpace>(`${MEET_BASE}/spaces`, {
      method: "POST",
      json: Object.keys(config).length > 0 ? { config } : {},
      authContext: { requestContext },
    });

    return mapSpace(space);
  },
});

export const meetGetSpaceTool = createTool({
  id: "meet_get_space",
  title: "Meet: get meeting space",
  description:
    "Get a Google Meet space by space ID or meeting code, including its join URL and active conference record.",
  inputSchema: z.object({
    space: z.string().describe("Space ID, full resource name (spaces/...), or meeting code (abc-defg-hij)"),
  }),
  outputSchema: spaceSchema,
  execute: async ({ space }, { requestContext }) => {
    const result = await googleRequest<MeetSpace>(
      `${MEET_BASE}/${encodePath(normalizeSpaceName(space))}`,
      { authContext: { requestContext } },
    );

    return mapSpace(result);
  },
});

export const meetUpdateSpaceTool = createTool({
  id: "meet_update_space",
  title: "Meet: update meeting space",
  description:
    "Update access, entry point, or moderation settings on a Google Meet space. Only the provided fields are patched.",
  inputSchema: z.object({
    space: z.string().describe("Space ID or full resource name (spaces/...)"),
    ...spaceConfigInput,
  }),
  outputSchema: spaceSchema,
  execute: async ({ space, accessType, entryPointAccess, moderation }, { requestContext }) => {
    const config = compact({ accessType, entryPointAccess, moderation });
    const updateMask = Object.keys(config)
      .map((key) => `config.${key}`)
      .join(",");

    if (updateMask.length === 0) {
      throw new Error("Provide at least one of accessType, entryPointAccess, or moderation.");
    }

    const result = await googleRequest<MeetSpace>(
      `${MEET_BASE}/${encodePath(normalizeSpaceName(space))}`,
      {
        method: "PATCH",
        query: { updateMask },
        json: { config },
        authContext: { requestContext },
      },
    );

    return mapSpace(result);
  },
});

export const meetEndActiveConferenceTool = createTool({
  id: "meet_end_active_conference",
  title: "Meet: end active conference",
  description:
    "End the active conference in a Google Meet space, if one is running. The space and its join link remain usable.",
  inputSchema: z.object({
    space: z.string().describe("Space ID or full resource name (spaces/...)"),
  }),
  outputSchema: z.object({
    space: z.string(),
    ended: z.boolean(),
  }),
  execute: async ({ space }, { requestContext }) => {
    const name = normalizeSpaceName(space);

    await googleRequest(`${MEET_BASE}/${encodePath(name)}:endActiveConference`, {
      method: "POST",
      authContext: { requestContext },
    });

    return { space: name, ended: true };
  },
});

export const meetListConferenceRecordsTool = createTool({
  id: "meet_list_conference_records",
  title: "Meet: list conference records",
  description:
    "List past and ongoing Google Meet conferences, newest first. Filter by space, meeting code, or start time. Records expire 30 days after a conference ends.",
  inputSchema: z.object({
    pageSize: z.number().int().min(1).max(100).default(25).describe("Maximum records to return (max 100)"),
    pageToken: z.string().optional().describe("Token from a previous page"),
    space: z.string().optional().describe("Only return conferences held in this space"),
    meetingCode: z.string().optional().describe("Only return conferences with this meeting code"),
    startTimeFrom: z
      .string()
      .optional()
      .describe("Only conferences starting at or after this RFC 3339 timestamp"),
    startTimeTo: z
      .string()
      .optional()
      .describe("Only conferences starting at or before this RFC 3339 timestamp"),
  }),
  outputSchema: z.object({
    conferenceRecords: z.array(conferenceRecordSchema),
    nextPageToken: z.string().optional(),
  }),
  execute: async (
    { pageSize, pageToken, space, meetingCode, startTimeFrom, startTimeTo },
    { requestContext },
  ) => {
    const filters: string[] = [];
    if (space) filters.push(`space.name = "${normalizeSpaceName(space)}"`);
    if (meetingCode) filters.push(`space.meeting_code = "${meetingCode}"`);
    if (startTimeFrom) filters.push(`start_time >= "${startTimeFrom}"`);
    if (startTimeTo) filters.push(`start_time <= "${startTimeTo}"`);

    const result = await googleRequest<MeetListResponse<MeetConferenceRecord>>(
      `${MEET_BASE}/conferenceRecords`,
      {
        query: {
          pageSize,
          pageToken,
          filter: filters.length > 0 ? filters.join(" AND ") : undefined,
        },
        authContext: { requestContext },
      },
    );

    return {
      conferenceRecords: (result.conferenceRecords ?? []).map(mapConferenceRecord),
      nextPageToken: result.nextPageToken,
    };
  },
});

export const meetListParticipantsTool = createTool({
  id: "meet_list_participants",
  title: "Meet: list participants",
  description:
    "List the participants in a Google Meet conference record, including signed-in users, anonymous guests, and phone dial-ins.",
  inputSchema: z.object({
    conferenceRecord: z
      .string()
      .describe("Conference record ID or full resource name (conferenceRecords/...)"),
    pageSize: z.number().int().min(1).max(250).default(100).describe("Maximum participants to return (max 250)"),
    pageToken: z.string().optional().describe("Token from a previous page"),
  }),
  outputSchema: z.object({
    participants: z.array(participantSchema),
    nextPageToken: z.string().optional(),
  }),
  execute: async ({ conferenceRecord, pageSize, pageToken }, { requestContext }) => {
    const parent = normalizeConferenceRecordName(conferenceRecord);

    const result = await googleRequest<MeetListResponse<MeetParticipant>>(
      `${MEET_BASE}/${encodePath(parent)}/participants`,
      {
        query: { pageSize, pageToken },
        authContext: { requestContext },
      },
    );

    return {
      participants: (result.participants ?? []).map(mapParticipant),
      nextPageToken: result.nextPageToken,
    };
  },
});

export const meetListRecordingsTool = createTool({
  id: "meet_list_recordings",
  title: "Meet: list recordings",
  description:
    "List recordings from a Google Meet conference record. Ready recordings include the Google Drive file ID and playback link.",
  inputSchema: z.object({
    conferenceRecord: z
      .string()
      .describe("Conference record ID or full resource name (conferenceRecords/...)"),
    pageSize: z.number().int().min(1).max(100).default(10).describe("Maximum recordings to return (max 100)"),
    pageToken: z.string().optional().describe("Token from a previous page"),
  }),
  outputSchema: z.object({
    recordings: z.array(recordingSchema),
    nextPageToken: z.string().optional(),
  }),
  execute: async ({ conferenceRecord, pageSize, pageToken }, { requestContext }) => {
    const parent = normalizeConferenceRecordName(conferenceRecord);

    const result = await googleRequest<MeetListResponse<MeetRecording>>(
      `${MEET_BASE}/${encodePath(parent)}/recordings`,
      {
        query: { pageSize, pageToken },
        authContext: { requestContext },
      },
    );

    return {
      recordings: (result.recordings ?? []).map(mapRecording),
      nextPageToken: result.nextPageToken,
    };
  },
});

export const meetListTranscriptsTool = createTool({
  id: "meet_list_transcripts",
  title: "Meet: list transcripts",
  description:
    "List transcripts from a Google Meet conference record. Ready transcripts include the Google Docs document ID and link.",
  inputSchema: z.object({
    conferenceRecord: z
      .string()
      .describe("Conference record ID or full resource name (conferenceRecords/...)"),
    pageSize: z.number().int().min(1).max(100).default(10).describe("Maximum transcripts to return (max 100)"),
    pageToken: z.string().optional().describe("Token from a previous page"),
  }),
  outputSchema: z.object({
    transcripts: z.array(transcriptSchema),
    nextPageToken: z.string().optional(),
  }),
  execute: async ({ conferenceRecord, pageSize, pageToken }, { requestContext }) => {
    const parent = normalizeConferenceRecordName(conferenceRecord);

    const result = await googleRequest<MeetListResponse<MeetTranscript>>(
      `${MEET_BASE}/${encodePath(parent)}/transcripts`,
      {
        query: { pageSize, pageToken },
        authContext: { requestContext },
      },
    );

    return {
      transcripts: (result.transcripts ?? []).map(mapTranscript),
      nextPageToken: result.nextPageToken,
    };
  },
});

export const meetListTranscriptEntriesTool = createTool({
  id: "meet_list_transcript_entries",
  title: "Meet: list transcript entries",
  description:
    "List the spoken entries in a Google Meet transcript, with speaker, text, language, and timestamps.",
  inputSchema: z.object({
    conferenceRecord: z
      .string()
      .describe("Conference record ID or full resource name (conferenceRecords/...)"),
    transcript: z
      .string()
      .describe("Transcript ID, transcripts/... resource, or full conferenceRecords/.../transcripts/... name"),
    pageSize: z.number().int().min(1).max(100).default(10).describe("Maximum entries to return (max 100)"),
    pageToken: z.string().optional().describe("Token from a previous page"),
  }),
  outputSchema: z.object({
    entries: z.array(transcriptEntrySchema),
    nextPageToken: z.string().optional(),
  }),
  execute: async ({ conferenceRecord, transcript, pageSize, pageToken }, { requestContext }) => {
    const parent = normalizeTranscriptName(conferenceRecord, transcript);

    const result = await googleRequest<MeetListResponse<MeetTranscriptEntry>>(
      `${MEET_BASE}/${encodePath(parent)}/entries`,
      {
        query: { pageSize, pageToken },
        authContext: { requestContext },
      },
    );

    return {
      entries: (result.entries ?? []).map((entry) => ({
        name: entry.name,
        participant: entry.participant,
        text: entry.text,
        languageCode: entry.languageCode,
        startTime: entry.startTime,
        endTime: entry.endTime,
      })),
      nextPageToken: result.nextPageToken,
    };
  },
});

export const meetTools = {
  meetCreateSpaceTool,
  meetGetSpaceTool,
  meetUpdateSpaceTool,
  meetEndActiveConferenceTool,
  meetListConferenceRecordsTool,
  meetListParticipantsTool,
  meetListRecordingsTool,
  meetListTranscriptsTool,
  meetListTranscriptEntriesTool,
};
