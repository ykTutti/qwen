import type { ModelOption, SearchSource, Skill } from '../types.js';

// The first entry of each list is the default model.
export const models: ModelOption[] = [
  { key: 'deepseek', name: 'DeepSeek', desc: '支持联网搜索，实时获取最新信息' },
  { key: 'qwen3.8-max', name: 'Qwen3.8-Max', desc: '最新旗舰模型，推理与综合能力更强' },
  { key: 'qwen3.8-flash', name: 'Qwen3.8-Flash', desc: '新一代极速模型，日常问答秒回' },
  { key: 'qwen3.7', name: 'Qwen3.7-千问', desc: '综合AI助手，全面回答工作、学习、生活各类问题' },
  { key: 'qwen3.7-max', name: 'Qwen3.7-Max', desc: '擅长代码编写，处理复杂任务' },
  { key: 'qwen3.6-flash', name: 'Qwen3.6-Flash', desc: '适用于简单任务，响应速度快' },
];

export const workModels: ModelOption[] = [
  { key: 'deepseek', name: 'DeepSeek', desc: '支持联网搜索，实时获取最新信息' },
  { key: 'qwen3.8-max', name: 'Qwen3.8-Max', desc: '旗舰模型，适合复杂办公任务' },
  { key: 'qwen3.8-flash', name: 'Qwen3.8-Flash', desc: '极速响应' },
  { key: 'qwen3.7-max', name: 'Qwen3.7-Max', desc: '擅长代码编写，处理复杂任务' },
  { key: 'qwen3.7-plus', name: 'Qwen3.7-Plus', desc: '均衡速度与效果' },
];

export const modes = [
  { key: 'fast', name: '快速', desc: '适用于大多数情况', icon: 'flash' },
  { key: 'research', name: '思考研究', desc: '深度搜索、深度研究', icon: 'deepResearch' },
];

export const skills: Skill[] = [
  {
    key: 'agent', name: '工作助理', icon: 'pcicon-agentMode', badge: '云端',
    heroTitle: '千问，你的办公助理', placeholder: '今天一起做点什么？',
  },
  {
    key: 'video', name: 'AI生视频', icon: 'video', heroTitle: '一句话生成视频',
    href: 'https://create.qianwen.com/r/ai-studio-pc/main/gen?c_et_from=qwen_pc_capsule&fp_from=qwen_pc_capsule&tab=video',
    placeholder: '描述你想要的视频画面，例如：一只柴犬在樱花树下奔跑',
    options: [
      { label: '比例', icon: 'square', dropdown: ['16:9', '9:16', '1:1'] },
      { label: '时长', icon: 'playCircle', dropdown: ['5 秒', '10 秒'] },
    ],
  },
  {
    key: 'ppt', name: 'PPT创作', icon: 'PPT', heroTitle: '万物皆可PPT',
    placeholder: '输入主题，一键生成 PPT',
    options: [
      { label: '专家模式', icon: 'deepResearch', dropdown: ['专家模式', '快速模式'] },
      { label: '参考资料', icon: 'fileUpload' },
      { label: '页数', icon: 'genre', dropdown: ['10 页以内', '10-20 页', '20 页以上'] },
    ],
  },
  {
    key: 'image', name: 'AI生图', icon: 'aiPicture', heroTitle: '想画什么，说给我听',
    placeholder: '描述你想要的画面，例如：赛博朋克风格的杭州西湖夜景',
    options: [
      { label: '比例', icon: 'square', dropdown: ['1:1', '3:4', '4:3', '16:9', '9:16'] },
      { label: '风格', icon: 'aiPicture', dropdown: ['智能', '写实', '动漫', '国风', '油画'] },
    ],
  },
  { key: 'code', name: '代码', icon: 'code', heroTitle: '你的编程搭档', placeholder: '描述你的编程需求，或粘贴代码让我解读' },
  {
    key: 'translate', name: '翻译', icon: 'translate', heroTitle: '多语种精准翻译', placeholder: '输入或粘贴需要翻译的内容',
    options: [{ label: '自动检测 → 中文', icon: 'translate', dropdown: ['自动检测 → 中文', '中文 → 英文', '中文 → 日文'] }],
  },
  { key: 'write', name: 'AI写作', icon: 'aiWriting', heroTitle: '帮你写出好文章', placeholder: '写一篇文章、邮件、周报或文案…' },
  { key: 'record', name: '录音纪要', icon: 'acoustic', heroTitle: '录音转文字，一键出纪要', placeholder: '上传录音文件，自动生成会议纪要' },
  { key: 'research', name: '研究', icon: 'deepResearch', heroTitle: '深度研究，生成专业报告', placeholder: '输入你想研究的课题' },
  { key: 'gaokao', name: '千问高考', icon: 'graduationCap', heroTitle: '千问高考，志愿填报好帮手', placeholder: '输入分数和省份，帮你推荐院校' },
  { key: 'av', name: '音视频速读', icon: 'audioAndVideo', heroTitle: '音视频速读', placeholder: '粘贴音视频链接，快速提炼要点' },
];

export const toolbarSkillKeys = ['agent', 'video', 'ppt', 'image'];

export const plusMenu = [
  { key: 'doc', label: '上传文档', icon: 'fileUpload', accept: '.pdf,.doc,.docx,.txt,.md,.xls,.xlsx,.ppt,.pptx' },
  { key: 'img', label: '上传图片', icon: 'aiPicture', accept: 'image/*' },
  { key: 'screen', label: '共享屏幕和应用', icon: 'readMyScreen', arrow: true },
  { key: 'shot', label: '截屏提问', icon: 'screenshot', arrow: true },
];

export const promos = [
  { title: '工作任务就交给千问工作助理', desc: '专业技能搭配行业数据连接器，助理选的好，当然下班早', action: '立即体验', skill: 'agent', art: 'agent' },
  { title: '千问输入法 App 全新上线', desc: '最快 300 字/分，说话即成稿，支持 9 种方言，无广告', action: '立即下载体验', art: 'ime' },
  { title: '千问一键生成录音纪要', desc: '断网也能稳定录，纪要自动整理，重要内容一句不漏', action: '立即下载体验', art: 'record' },
];

export const workStarters = [
  { text: '根据产品介绍，提炼卖点并生成宣传文案', icon: 'copywriting' },
  { text: '解析岗位要求，梳理简历撰写核心要点', icon: 'resume' },
  { text: '每周推送本周科技圈新鲜事', icon: 'technews' },
  { text: '分析板块资金动向，判断市场热点和行业趋势', icon: 'market' },
  { text: '收集目标行业信息，生成深度调研报告', icon: 'research' },
  { text: '制作百花奖历届获奖作品展示网页', icon: 'webpage' },
];

export const designStarters = [
  { text: '做一个番茄钟 App 的可交互原型，包含计时、统计和设置页', icon: 'webpage' },
  { text: '为一款宠物社交 App 发散 5 个差异化的产品方向', icon: 'research' },
  { text: '把「社区二手书交换」的想法做成一个落地页原型', icon: 'webpage' },
  { text: '给记账 App 的新手引导设计 3 套不同的交互方案', icon: 'copywriting' },
  { text: '设计一个团队周报看板，用卡片和图表展示进度', icon: 'market' },
  { text: '为线下咖啡店会员小程序梳理核心流程并出原型', icon: 'resume' },
];

export const pptTemplates = [
  { name: '商务汇报', from: '#3a6df0', to: '#8fb3ff' },
  { name: '年终总结', from: '#e8524a', to: '#ffb199' },
  { name: '教学课件', from: '#15a47a', to: '#9ee6c8' },
  { name: '产品发布', from: '#111', to: '#555' },
  { name: '国风雅致', from: '#b0803d', to: '#f1d9a7' },
  { name: '科技未来', from: '#5b3cf5', to: '#3ad1ff' },
];

export const imageExamples = [
  '赛博朋克风格的杭州西湖夜景',
  '水彩画风格的江南小镇清晨',
  '一只戴着宇航员头盔的橘猫',
  '极简主义的咖啡店海报',
];

export const mockSources: SearchSource[] = [
  { title: '官方文档 - 快速入门与最佳实践', site: '知乎', url: '#' },
  { title: '2026 年最新行业趋势深度解读', site: '36氪', url: '#' },
  { title: '专家观点：如何理解这一问题', site: '新华网', url: '#' },
  { title: '完整指南：从入门到精通', site: 'CSDN', url: '#' },
  { title: '百科词条：相关概念与定义', site: '百度百科', url: '#' },
  { title: '用户经验分享与实测对比', site: '小红书', url: '#' },
  { title: '深度长文：背后的原理与演进', site: '少数派', url: '#' },
  { title: '问答精选：常见误区汇总', site: '知乎', url: '#' },
];

export const appConfig = {
  models,
  workModels,
  modes,
  skills,
  toolbarSkillKeys,
  plusMenu,
  promos,
  workStarters,
  designStarters,
  pptTemplates,
  imageExamples,
};
