---
name: design
description: 设计模式专用流程：先规划页面与公共组件，写入 规划.md 和 design.json 骨架，再由主 agent 实现公共组件，最后并行派发子 agent 各自实现一个页面（HTML + CSS + JS）并登记到 design.json。
metadata:
  title: 设计
  hidden: "true"
---

# 设计落地流程

用户把要设计的内容说清楚之后（产品是什么、给谁用、大致有哪些页面或功能），严格按下面 5 个步骤在同一轮里一口气完成，中途不要停下来等确认。需求还模糊时先不要写文件，按「发散构思」的要求帮用户想清楚、问清楚。

用户看到的预览是一张**设计画布**：design.json 里的每个页面是画布上的一个节点，节点里用 iframe 按真实屏幕尺寸渲染该页面的 HTML，页面之间按导航关系连线。子 agent 每登记完一个页面，画布上对应的节点就会实时出现。

## 目录结构

所有产出都放在工作区根目录下，结构固定：

```
规划.md                     # 第 1 步：规划
design.json                 # 第 1 步：画布骨架；第 3 步由子 agent 登记页面
components/
  tokens.css                # 第 2 步：设计令牌（CSS 变量）
  components.css            # 第 2 步：公共组件样式
  components.js             # 第 2 步：公共组件（Web Components）
pages/
  <page-id>.html            # 第 3 步：每个页面三个文件，由子 agent 实现
  <page-id>.css
  <page-id>.js
```

- 页面 ID 用小写英文和连字符，如 `home`、`order-detail`；子 agent ID 用 `agent-1`、`agent-2`……，一个子 agent 只负责一个页面。
- 页面之间用相对路径跳转：`./order-detail.html`。

## 第 1 步：规划，写入 规划.md 和 design.json

### 1.1 规划.md

先想清楚再动手，用 write_file 写 `规划.md`，必须包含以下内容：

```markdown
# <产品名> 原型规划

## 概述
- 产品定位、目标用户、核心场景
- 平台与屏幕尺寸：移动端 390×844，或桌面端 1440×900
- 视觉风格：主色 / 辅色 / 背景色、字体、圆角、阴影、整体调性

## 页面总览
共 N 个页面。

| 页面 ID | 页面名称 | 文件 | 包含的公共组件 | 子 agent ID |
| --- | --- | --- | --- | --- |
| home | 首页 | pages/home.html | app-navbar, app-tabbar | agent-1 |

## 公共组件
### app-navbar · 顶部导航栏
- 用法：`<app-navbar title="首页" back="./home.html"></app-navbar>`
- 属性：title 标题；back 返回链接，可省略
- 被这些页面使用：home、detail

## 页面详情
### home · 首页（agent-1）
- 页面目标：
- 内容模块（自上而下）：
- 交互：
- 使用的公共组件：
- 跳转关系：点击 xx → detail
```

- 页面数量按需求定，通常 3～6 个；只规划能撑起核心流程的页面，不要凑数。
- 至少两个页面都会用到的元素才做成公共组件（导航栏、底部标签栏、按钮、卡片、弹窗、空状态等）；只出现一次的放在页面里实现。

### 1.2 design.json 骨架

紧接着用 write_file 写 `design.json`，内容与规划一致。此时页面还没实现，所有页面的 `html` 都填 `null`、`status` 填 `"pending"`；`edges` 按规划里的跳转关系写，每条是一次「从哪个页面跳到哪个页面」：

```json
{
  "title": "<产品名>",
  "platform": "mobile",
  "viewport": { "width": 390, "height": 844 },
  "pages": [
    { "id": "home", "name": "首页", "description": "一句话说明页面用途", "agentId": "agent-1", "html": null, "status": "pending" },
    { "id": "detail", "name": "详情页", "description": "……", "agentId": "agent-2", "html": null, "status": "pending" }
  ],
  "edges": [
    { "from": "home", "to": "detail", "label": "点击活动卡片" },
    { "from": "detail", "to": "home", "label": "返回" }
  ]
}
```

- `platform` 为 `"mobile"`（viewport 390×844）或 `"desktop"`（viewport 1440×900）。
- `pages` 的顺序就是主流程顺序，第一个是入口页。
- 写完骨架后不要再用 write_file / edit_file 整体覆盖 design.json（会冲掉子 agent 的登记）；页面的登记一律通过 update_design 工具完成。

## 第 2 步：主 agent 实现公共组件

由你自己（不要派子 agent）完成：

1. `components/tokens.css`：在 `:root` 里定义颜色、字号、间距、圆角、阴影等 CSS 变量，并写好 `* { box-sizing: border-box }`、`html, body { margin: 0; min-height: 100% }`、body 字体与背景等基础样式。
   - 画布会按 viewport 尺寸直接渲染每个页面，所以**页面本身就是整块屏幕**：不要再画手机外框或把内容居中成一个小卡片，内容铺满宽度，超出高度时页面自然滚动；底部标签栏等用 `position: sticky` 或 `fixed` 贴底。
2. `components/components.js`：每个公共组件用 Web Component 实现，统一前缀 `app-`：
   - `class AppNavbar extends HTMLElement { connectedCallback() { … this.innerHTML = '…' } }` + `customElements.define('app-navbar', AppNavbar)`；
   - 不用 Shadow DOM，直接渲染到元素内部，让 tokens.css 和 components.css 的样式生效；
   - 通过属性传参；需要高亮当前页的组件（如标签栏）用 `active="<page-id>"` 属性；组件里的跳转链接写 `./<page-id>.html`；
   - 需要对外通知的交互用 `this.dispatchEvent(new CustomEvent('app-xxx', { detail, bubbles: true }))`。
3. `components/components.css`：组件的样式，只使用 tokens.css 里的变量。
4. 写完后用 `node --check components/components.js` 检查语法；如果规划里的组件用法在实现时有调整，同步更新 规划.md。

## 第 3 步：并行派发子 agent，每个实现一个页面

在**同一次回复**里为每个页面各发起一个 run_subagent 调用（它们会并行执行；超过 6 个页面就分批，每批最多 6 个）：

- `agent_id` 填规划里的子 agent ID，`description` 写「<页面 ID>：<页面名称>」。
- 子 agent 看不到对话，`prompt` 要自成一体，按这个模板写全：

```
你负责实现原型「<产品名>」中的一个页面：<页面 ID> · <页面名称>。

【开始前】先 read_file 阅读 规划.md、components/components.js、components/tokens.css，了解整体风格和公共组件用法。

【需要新建的文件】只新建这三个文件，不要修改其他任何文件（尤其是 components/、design.json 和别的页面）：
- pages/<page-id>.html
- pages/<page-id>.css
- pages/<page-id>.js

【HTML 骨架】
<link rel="stylesheet" href="../components/tokens.css">
<link rel="stylesheet" href="../components/components.css">
<link rel="stylesheet" href="./<page-id>.css">
……页面内容……
<script src="../components/components.js" defer></script>
<script src="./<page-id>.js" defer></script>

【屏幕】页面按 <宽>×<高> 渲染，页面本身就是整块屏幕：内容铺满宽度，不要画手机外框，超出高度自然滚动。

【本页使用的公共组件】逐个写出标签和属性用法，例如 <app-tabbar active="<page-id>"></app-tabbar>

【页面内容】从 规划.md 中复制本页的目标、内容模块、交互、跳转关系，并补充必要细节。

【要求】页面样式写在 <page-id>.css 并优先使用 tokens.css 的变量；交互逻辑写在 <page-id>.js，用原生 JS；使用合理的中文假数据；核心交互真的能点；跳转其他页面用 ./<目标页面 ID>.html。

【登记】三个文件写好并通过 node --check 后，调用 update_design：page_id 为 "<page-id>"，html 为 "pages/<page-id>.html"，links 列出本页实际实现的跳转（to 为目标页面 ID，label 为触发方式）。

【报告】列出新建的文件、实现了哪些模块和交互、做了哪些假设、未完成的部分。
```

## 第 4 步：验收

全部子 agent 返回后：

- 用 list_dir 确认 `pages/` 下每个页面的三个文件都在；用 `node --check pages/<page-id>.js` 检查脚本语法。
- read_file 查看 design.json，确认每个页面都已登记（`html` 不为 null）；漏登记的页面由你调用 update_design 补上。
- 抽查页面是否正确引用了公共组件和自己的 css/js、跳转链接是否指向存在的页面。
- 小问题自己用 edit_file 直接修；某个子 agent 失败或页面明显缺失时，重新为该页面派发一次子 agent。

## 第 5 步：回复用户

- 用几句话说明：做了哪些页面、有哪些公共组件、核心流程怎么走；提示用户在右侧设计画布里查看全部页面，点击页面即可在里面直接操作。
- 写出关键假设，并给出 1～2 个可以继续深化的方向。
- 文件会自动以卡片形式附在回复末尾，不要贴代码、文件链接或完整规划。

## 后续修改

- 只改某个页面：直接用 edit_file 修改该页面的文件；改动较大时可以只为这个页面派一个子 agent。
- 改公共组件或整体风格：由你修改 components/ 下的文件，必要时检查受影响的页面。
- 增删页面或调整跳转：先更新 规划.md；新增页面时用 edit_file 在 design.json 的 pages 里追加一个 `html: null` 的页面（以及相关 edges），再按第 3 步只为新增或重做的页面派发子 agent。
