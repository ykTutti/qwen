import type { Conversation, Message, User } from '../types.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

export const DEFAULT_AVATAR = 'https://img.alicdn.com/imgextra/i3/O1CN01QLt9r31b7x4MN6qUL_!!6000000003419-2-tps-116-116.png';
const SPACE_ICON = 'https://img.alicdn.com/imgextra/i4/O1CN019bEe9k20NrQZ6bMj1_!!6000000006838-2-tps-96-96.png';

export function seedUser(account: string): User {
  return {
    id: `u_${Buffer.from(account).toString('hex').slice(0, 12)}`,
    name: '千问用户',
    account,
    phone: '138****6688',
    avatar: DEFAULT_AVATAR,
  };
}

export function seedConversations(now = Date.now()): Conversation[] {
  return [
    { id: 'c1', title: '杭州两日游路线规划', updatedAt: now - 0.5 * HOUR, surface: 'daily' },
    { id: 'c2', title: 'React 性能优化方案', updatedAt: now - 2 * HOUR, surface: 'daily' },
    { id: 'c3', title: '季度工作汇报 PPT 大纲', updatedAt: now - 5 * HOUR, surface: 'daily' },
    { id: 'c4', title: '什么是 Transformer 架构', updatedAt: now - 1.2 * DAY, surface: 'daily' },
    { id: 'c5', title: '英文邮件润色', updatedAt: now - 2 * DAY, surface: 'daily' },
    { id: 'c6', title: '家常红烧肉做法', updatedAt: now - 3.5 * DAY, surface: 'daily' },
    { id: 'c7', title: 'SQL 慢查询排查思路', updatedAt: now - 5 * DAY, surface: 'daily' },
    { id: 'w1', title: '竞品调研报告', updatedAt: now - 3 * HOUR, surface: 'work' },
    { id: 'w2', title: '周会纪要整理', updatedAt: now - 1.5 * DAY, surface: 'work' },
  ];
}

export function seedMessages(now = Date.now()): Record<string, Message[]> {
  return {
    c1: [
      { id: 'm1', role: 'user', content: '周末去杭州玩两天，有什么推荐路线？', createdAt: now - 0.5 * HOUR },
      {
        id: 'm2', role: 'assistant', status: 'done', createdAt: now - 0.5 * HOUR,
        keywords: ['杭州两日游 路线', '西湖 周末 攻略'],
        sources: [
          { title: '杭州两日游最全攻略，本地人推荐', site: '小红书', url: '#' },
          { title: '西湖景区周末交通管制说明', site: '杭州发布', url: '#' },
          { title: '灵隐寺开放时间与门票', site: '携程', url: '#' },
        ],
        content: `为你规划一条**经典 + 轻松**的杭州两日游路线：

### 第一天：西湖经典环线
- **上午**：断桥残雪 → 白堤 → 孤山，沿湖慢走
- **中午**：楼外楼 / 知味观，推荐西湖醋鱼、东坡肉、龙井虾仁
- **下午**：苏堤春晓 → 花港观鱼 → 雷峰塔，傍晚在雷峰塔看日落
- **晚上**：湖滨步行街 + 音乐喷泉（19:00 / 20:00 场）

### 第二天：人文 + 茶园
- **上午**：灵隐寺 & 飞来峰（建议 8 点前到，避开人流）
- **中午**：龙井村农家菜，顺便品一杯明前龙井
- **下午**：九溪十八涧徒步，或去中国茶叶博物馆
- **晚上**：河坊街 / 南宋御街，逛吃小吃

> 小贴士：周末西湖周边限行，建议地铁 + 共享单车出行。`,
      },
    ],
    c2: [
      { id: 'm1', role: 'user', content: 'React 列表很卡，有哪些优化方案？', createdAt: now - 2 * HOUR },
      {
        id: 'm2', role: 'assistant', status: 'done', createdAt: now - 2 * HOUR,
        content: `列表卡顿通常有以下几类原因和对应的优化手段：

| 问题 | 优化方案 |
| --- | --- |
| 渲染节点过多 | 虚拟列表（react-window / react-virtuoso） |
| 无效重渲染 | \`React.memo\` + 稳定的 \`key\` 与回调 |
| 计算量大 | \`useMemo\` 缓存派生数据 |
| 频繁输入触发过滤 | \`useDeferredValue\` / 防抖 |

示例：

\`\`\`tsx
const Row = React.memo(({ item }: { item: Item }) => <div>{item.name}</div>);

function List({ items }: { items: Item[] }) {
  return items.map((it) => <Row key={it.id} item={it} />);
}
\`\`\`

建议先用 React DevTools Profiler 定位瓶颈，再有针对性地优化。`,
      },
    ],
  };
}

export function seedCloudSpace(now = Date.now()) {
  return [
    { id: 's1', name: '季度工作汇报.pptx', icon: SPACE_ICON, updatedAt: now - 3 * HOUR },
    { id: 's2', name: '杭州西湖夜景（AI 生图）', icon: SPACE_ICON, updatedAt: now - 6 * HOUR },
    { id: 's3', name: '周会录音纪要 2026-09-26', icon: SPACE_ICON, updatedAt: now - 1.5 * DAY },
    { id: 's4', name: '竞品调研报告.docx', icon: SPACE_ICON, updatedAt: now - 2 * DAY },
    { id: 's5', name: 'React 性能优化笔记', icon: SPACE_ICON, updatedAt: now - 4 * DAY },
    { id: 's6', name: '产品需求文档模板', icon: SPACE_ICON, updatedAt: now - 9 * DAY },
  ];
}
