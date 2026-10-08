import { isWorkLike, type Surface } from '../../types.js';
import { askUserQuestionTool } from './askUser.js';
import { updateDesignTool } from './design.js';
import { fileTools } from './files.js';
import { saveSkillTool } from './skills.js';
import { subagentTool } from './subagent.js';
import { terminalTools } from './terminal.js';
import type { AgentTool } from './types.js';
import { webSearchTool } from './webSearch.js';

const dailyTools: AgentTool<any>[] = [webSearchTool, askUserQuestionTool];
const designTools: AgentTool<any>[] = [webSearchTool, askUserQuestionTool, ...fileTools, ...terminalTools, updateDesignTool, subagentTool];
const workTools: AgentTool<any>[] = [webSearchTool, askUserQuestionTool, ...fileTools, ...terminalTools, saveSkillTool];

/** Local file and shell tools are only offered in work and design mode; skills are work-only, sub-agents design-only. */
export function toolsFor(surface: Surface) {
  const tools = surface === 'work' ? workTools : isWorkLike(surface) ? designTools : dailyTools;
  return {
    definitions: tools.map((t) => t.definition),
    map: new Map(tools.map((t) => [t.definition.function.name, t])),
  };
}
