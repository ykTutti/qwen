export type Role = 'user' | 'assistant';
export type Surface = 'daily' | 'work';
export type ChatMode = 'fast' | 'research';

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
      error?: string;
      startedAt?: number;
      endedAt?: number;
    };

export interface Message {
  id: string;
  role: Role;
  content: string;
  thinking?: string;
  keywords?: string[];
  sources?: SearchSource[];
  blocks?: AgentBlock[];
  attachments?: string[];
  skill?: string;
  status?: 'pending' | 'analyzing' | 'streaming' | 'done' | 'stopped';
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  surface: Surface;
  pinned?: boolean;
  unread?: boolean;
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

export interface User {
  id: string;
  name: string;
  account: string;
  phone: string;
  avatar: string;
}

export interface ModeOption {
  key: ChatMode;
  name: string;
  desc: string;
  icon: string;
}

export interface PlusMenuItem {
  key: string;
  label: string;
  icon: string;
  accept?: string;
  arrow?: boolean;
}

export interface Promo {
  title: string;
  desc: string;
  action: string;
  art: string;
  skill?: string;
}

export interface AppConfig {
  models: ModelOption[];
  workModels: ModelOption[];
  modes: ModeOption[];
  skills: Skill[];
  toolbarSkillKeys: string[];
  plusMenu: PlusMenuItem[];
  promos: Promo[];
  workStarters: { text: string; icon: string }[];
  pptTemplates: { name: string; from: string; to: string }[];
  imageExamples: string[];
}

export interface SearchHit {
  conversation: Conversation;
  snippet?: string;
}

export interface CloudSpaceItem {
  id: string;
  name: string;
  icon: string;
  updatedAt: number;
}

export type ToastType = 'success' | 'error' | 'info';
export type ToastFn = (text: string, type?: ToastType) => void;
