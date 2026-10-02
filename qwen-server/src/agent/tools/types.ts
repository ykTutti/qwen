import type { LlmTool, ModelTarget } from '../../llm/client.js';
import type { SearchSource } from '../../types.js';

export interface ToolOutput {
  /** Serialized result handed back to the model as the `tool` message. */
  content: string;
  /** Structured results shown in the chat UI. */
  sources?: SearchSource[];
  /** One-line result shown next to the tool name in the chat UI. */
  summary?: string;
  /** Expandable text preview (file content, command output) shown in the chat UI. */
  output?: string;
}

/** One conversation's sandbox: its private work dir on the host, mounted as /workspace in its container. */
export interface AgentSession {
  id: string;
  dir: string;
}

export interface ToolContext {
  signal: AbortSignal;
  session?: AgentSession;
  /** Live status for long-running tools; updates the tool's card while it is still running. */
  progress?: (update: { summary?: string; output?: string }) => void;
  /** Called after a tool may have changed the work dir, so live views (the design canvas) can refresh. */
  changed?: () => void;
  /** Model the conversation runs on; tools that call the model themselves (sub-agents) use the same one. */
  model?: ModelTarget;
}

export interface AgentTool<Args = Record<string, unknown>> {
  definition: LlmTool;
  execute(args: Args, ctx: ToolContext): Promise<ToolOutput>;
}
