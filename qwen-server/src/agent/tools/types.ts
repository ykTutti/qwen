import type { LlmTool } from '../../llm/deepseek.js';
import type { SearchSource } from '../../types.js';

export interface ToolOutput {
  /** Serialized result handed back to the model as the `tool` message. */
  content: string;
  /** Structured results shown in the chat UI. */
  sources?: SearchSource[];
}

export interface AgentTool<Args = Record<string, unknown>> {
  definition: LlmTool;
  execute(args: Args, ctx: { signal: AbortSignal }): Promise<ToolOutput>;
}
