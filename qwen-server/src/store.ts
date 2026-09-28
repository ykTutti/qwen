import { randomBytes } from 'node:crypto';
import type { Conversation, Message, User } from './types.js';
import { seedCloudSpace, seedConversations, seedMessages, seedUser } from './data/seed.js';

export interface Workspace {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  cloudSpace: ReturnType<typeof seedCloudSpace>;
}

const users = new Map<string, User>();
const sessions = new Map<string, string>();
const workspaces = new Map<string, Workspace>();

export const newId = (prefix = '') => `${prefix}${randomBytes(6).toString('hex')}`;

function emptyWorkspace(): Workspace {
  return { conversations: [], messages: {}, cloudSpace: [] };
}

function seededWorkspace(): Workspace {
  const now = Date.now();
  return { conversations: seedConversations(now), messages: seedMessages(now), cloudSpace: seedCloudSpace(now) };
}

export function guestOwner(clientId: string) {
  return `guest:${clientId}`;
}

export function getWorkspace(owner: string): Workspace {
  let ws = workspaces.get(owner);
  if (!ws) {
    ws = owner.startsWith('guest:') ? emptyWorkspace() : seededWorkspace();
    workspaces.set(owner, ws);
  }
  return ws;
}

export function login(account: string, clientId?: string) {
  let user = users.get(account);
  if (!user) {
    user = seedUser(account);
    users.set(account, user);
  }
  const token = newId('tk_');
  sessions.set(token, user.id);
  if (clientId) mergeGuest(guestOwner(clientId), user.id);
  return { token, user };
}

export function logout(token: string) {
  sessions.delete(token);
}

export function userByToken(token: string | undefined): User | undefined {
  if (!token) return undefined;
  const id = sessions.get(token);
  if (!id) return undefined;
  for (const u of users.values()) if (u.id === id) return u;
  return undefined;
}

function mergeGuest(from: string, to: string) {
  const guest = workspaces.get(from);
  if (!guest || guest.conversations.length === 0) return;
  const target = getWorkspace(to);
  const kept = guest.conversations.filter((c) => !c.temporary && !target.conversations.some((t) => t.id === c.id));
  target.conversations.unshift(...kept);
  for (const c of kept) target.messages[c.id] = guest.messages[c.id] ?? [];
  workspaces.delete(from);
}
