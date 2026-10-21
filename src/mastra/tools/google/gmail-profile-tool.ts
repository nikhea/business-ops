import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { googleRequest } from "./google-auth";

interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export const gmailGetProfileTool = createTool({
  id: "gmail_get_profile",
  title: "Gmail: get profile",
  description:
    "Get the profile of the authenticated Gmail account: email address, total message and thread counts, and current history ID. Use it to confirm which account the tools are acting on.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    emailAddress: z.string(),
    messagesTotal: z.number(),
    threadsTotal: z.number(),
    historyId: z.string(),
  }),
  execute: async (_input, { requestContext }) =>
    googleRequest<GmailProfile>("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      authContext: { requestContext },
    }),
});
