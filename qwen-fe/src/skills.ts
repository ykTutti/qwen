import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api/client';
import type { AgentSkill } from './types';

/** Built-in skill behind the "新建" button on the skills page; hidden from the list itself. */
export const SKILL_CREATOR = 'skill-creator';

let skills: AgentSkill[] = [];
let loaded = false;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function refreshSkills() {
  pending ??= api.skills()
    .then((list) => {
      skills = list;
      loaded = true;
      listeners.forEach((l) => l());
    })
    .finally(() => { pending = null; });
  return pending;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

/** Shared skill list, fetched on first use. Includes hidden skills; filter them out where they shouldn't be listed. */
export function useSkills() {
  const list = useSyncExternalStore(subscribe, () => skills);
  useEffect(() => {
    if (!loaded) refreshSkills().catch(() => undefined);
  }, []);
  return { skills: list, loaded: useSyncExternalStore(subscribe, () => loaded) };
}
