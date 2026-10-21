import {
  createTavilySearchTool,
  createTavilyExtractTool,
} from "@mastra/tavily";

const searchTool = createTavilySearchTool();
const extractTool = createTavilyExtractTool();

export { searchTool, extractTool };
