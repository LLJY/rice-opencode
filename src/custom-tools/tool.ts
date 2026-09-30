import { z } from "zod";

export type ToolContext = {
  worktree: string;
  directory: string;
  sessionID: string;
  messageID: string;
  agent: string;
  abort: AbortSignal;
  metadata(value: { title?: string; metadata?: Record<string, unknown> }): void;
  ask(input: {
    permission: string;
    patterns: string[];
    always: string[];
    metadata: Record<string, unknown>;
  }): Promise<void>;
};

export type ToolResult = { output: string; metadata?: Record<string, unknown> };
export type ToolResponse = string | ToolResult;
export type ToolArgs<Shape extends z.ZodRawShape> = z.output<z.ZodObject<Shape>>;

export type ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> = {
  description: string;
  args: Shape;
  schema: z.ZodObject<Shape>;
  execute(args: ToolArgs<Shape>, context: ToolContext): Promise<ToolResponse>;
};

function defineTool<Shape extends z.ZodRawShape>(
  definition: Omit<ToolDefinition<Shape>, "schema">,
): ToolDefinition<Shape> {
  return { ...definition, schema: z.object(definition.args) };
}

export const tool = Object.assign(defineTool, { schema: z });
