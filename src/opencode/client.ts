import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { config } from "../config.js";

export const opencodeClient = createOpencodeClient({
  baseUrl: config.opencode.apiUrl,
  auth: config.opencode.apiKey,
});
