import { saveSkill } from '../../skills.js';
import type { AgentTool } from './types.js';

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export const saveSkillTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'save_skill',
      description: '把一个技能保存到技能库（技能目录下的 SKILL.md），保存后会出现在用户的「技能」列表中。只在用户要求创建或更新技能、并确认内容后调用。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '技能标识：小写字母、数字和连字符，如 weekly-report，最长 64 个字符' },
          title: { type: 'string', description: '中文显示名称，如「周报助手」' },
          description: { type: 'string', description: '一两句话说明技能做什么、何时使用，最长 1024 个字符' },
          instructions: { type: 'string', description: '完整的技能说明（Markdown 正文，不含 front matter）' },
          overwrite: { type: 'boolean', description: '同名技能已存在时是否覆盖，需先征得用户同意，默认 false' },
        },
        required: ['name', 'title', 'description', 'instructions'],
      },
    },
  },
  async execute(args) {
    const { skill, content, updated } = await saveSkill({
      name: str(args.name),
      title: str(args.title),
      description: str(args.description),
      instructions: str(args.instructions),
      overwrite: args.overwrite === true,
    });
    return {
      summary: `${updated ? '已更新' : '已创建'}技能「${skill.title}」`,
      output: content.length > 4000 ? `${content.slice(0, 4000)}\n…` : content,
      content: JSON.stringify({ name: skill.name, title: skill.title, updated }),
    };
  },
};
