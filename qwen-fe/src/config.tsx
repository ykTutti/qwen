import { createContext, useContext, type ReactNode } from 'react';
import type { AppConfig } from './types';

const ConfigContext = createContext<AppConfig | null>(null);

export function ConfigProvider({ value, children }: { value: AppConfig; children: ReactNode }) {
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): AppConfig {
  const cfg = useContext(ConfigContext);
  if (!cfg) throw new Error('useConfig must be used within ConfigProvider');
  return cfg;
}

const starterIcons = import.meta.glob<string>('./assets/starters/*.svg', { eager: true, import: 'default' });

export function starterIcon(name: string) {
  return starterIcons[`./assets/starters/${name}.svg`] ?? '';
}
