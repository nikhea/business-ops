/**
 * Test helper for calling Mastra tools directly.
 *
 * `tool.execute()` is typed as a union that includes `void` and validation
 * errors. Tests assert on concrete outputs, so this helper narrows the result.
 */

export const toolContext = { requestContext: { get: () => undefined } } as never;

interface ExecutableTool {
  execute?: (...args: any[]) => any;
}

export async function runTool(
  tool: ExecutableTool,
  input: unknown,
  context: unknown = toolContext,
): Promise<any> {
  if (!tool.execute) {
    throw new Error("Tool does not expose an execute function.");
  }

  return tool.execute(input, context);
}
