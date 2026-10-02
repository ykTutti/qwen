export type Role = 'user' | 'assistant';
export type Surface = 'daily' | 'work' | 'design';

/** Surfaces that run the agent with work dir, terminal and skills; design behaves like work for now. */
export const isWorkLike = (s: Surface) => s !== 'daily';
export type ChatMode = 'fast' | 'research';
export type MessageStatus = 'pending' | 'analyzing' | 'streaming' | 'done' | 'stopped';

export interface SearchSource {
  title: string;
  site: string;
  url: string;
  snippet?: string;
}

export type ToolStatus = 'pending' | 'running' | 'done' | 'error';

export type AgentBlock =
  | { type: 'reasoning'; text: string; startedAt: number; endedAt?: number }
  | { type: 'text'; text: string }
  | {
      type: 'tool';
      id: string;
      name: string;
      args: string;
      status: ToolStatus;
      results?: SearchSource[];
      summary?: string;
      output?: string;
      error?: string;
      startedAt?: number;
      endedAt?: number;
    };

/** A file the agent produced in its work dir, shown as a card at the end of the reply. */
export interface OutputFile {
  /** Relative to the conversation's work dir. */
  path: string;
  name: string;
  size: number;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  thinking?: string;
  keywords?: string[];
  sources?: SearchSource[];
  blocks?: AgentBlock[];
  files?: OutputFile[];
  attachments?: string[];
  skill?: string;
  status?: MessageStatus;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  surface: Surface;
  pinned?: boolean;
  temporary?: boolean;
  /** Server-generated id of this conversation's agent sandbox (work dir + container); never sent to the client. */
  sandboxId?: string;
}

export interface Skill {
  key: string;
  name: string;
  icon: string;
  badge?: string;
  href?: string;
  heroTitle?: string;
  placeholder?: string;
  options?: { label: string; icon: string; dropdown?: string[] }[];
}

export interface ModelOption {
  key: string;
  name: string;
  desc: string;
}

export interface ChatOptions {
  mode: ChatMode;
  model: string;
  skill?: string;
  attachments?: string[];
}

export interface User {
  id: string;
  name: string;
  account: string;
  phone: string;
  avatar: string;
}
