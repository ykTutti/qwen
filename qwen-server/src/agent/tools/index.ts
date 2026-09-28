import type { AgentTool } from './types.js';
import { webSearchTool } from './webSearch.js';

export const tools: AgentTool<any>[] = [webSearchTool];

export const toolMap = new Map(tools.map((t) => [t.definition.function.name, t]));

export const toolDefinitions = tools.map((t) => t.definition);
