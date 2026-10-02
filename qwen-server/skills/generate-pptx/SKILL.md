---
name: generate-pptx
description: "创建、编辑与优化 PPT，支持内容编排、图表排版与备注管理"
metadata:
  title: "PPT"
  source: custom
---

# PPT 生成器（仅输出 .pptx）

## 适用场景
用户要求生成/制作 PPT、演示文稿、幻灯片、汇报 slides、课程讲义等。

## 核心约束（必须严格遵守）
1. **唯一产物是 `.pptx` 文件**。不要额外生成 `.md`、`.py`、`.txt`、`.json`、图片、临时文件或说明文档。
2. 生成脚本写成**一次性命令**（`run_command` 里的 `python3 - <<'PY' ... PY`），或写到工作区**之外**的临时路径（如 `/tmp/build_ppt.py`）。**不要**把脚本、数据、目录清单等中间产物写进工作区。
3. 工作区里**只允许出现最终的那个 `.pptx`**。若过程中产生了其他文件，必须立即删除。
4. 文件名用有意义的中文名，如 `2026年Q3业务复盘.pptx`，放在工作区根目录。
5. 生成后用 `run_command` 校验：文件存在、能再次被 `Presentation()` 打开、幻灯片数量正确；同时确认工作区里没有多余文件。

## 交付方式（关键）
工作区里生成的 `.pptx` 会由系统**自动**以文件卡片的形式附在回复末尾，用户点击即可查看和下载。**不要**在回复里手写文件链接（如 `[文件名.pptx](文件名.pptx)`）。回复正文只写一两句说明（主题、页数、要点），**不要**贴出脚本内容或逐页正文。

## 技术要点
- 环境：Python 3.9 + python-pptx 1.0.2（已安装）。
- 画布默认 16:9：`prs.slide_width = Inches(13.333)`，`prs.slide_height = Inches(7.5)`。
- 不使用 `slide_layouts` 里带占位符的默认版式，统一用 `slide_layouts[6]`（空白版式），自己用 `add_textbox` / `add_shape` 排版，避免占位符残留文字。
- 中文字体：设置 `run.font.name = '微软雅黑'`；如需更稳，可同时设置东亚字体（见下方片段）。

```python
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
BLANK = prs.slide_layouts[6]

def set_font(run, size=18, bold=False, color=(0x22,0x22,0x22), name='微软雅黑'):
    run.font.size, run.font.bold = Pt(size), bold
    run.font.color.rgb = RGBColor(*color)
    run.font.name = name
    rPr = run._r.get_or_add_rPr()
    ea = rPr.makeelement('{http://schemas.openxmlformats.org/drawingml/2006/main}ea', {})
    ea.set('typeface', name); rPr.append(ea)

def textbox(slide, x, y, w, h, text, size=18, bold=False, color=(0x22,0x22,0x22),
            align=PP_ALIGN.LEFT):
    tf = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h)).text_frame
    tf.word_wrap = True
    for i, line in enumerate(text.split('\n')):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        set_font(p.add_run(), size, bold, color)
        p.runs[0].text = line
    return tf

def rect(slide, x, y, w, h, fill, line=None):
    from pptx.enum.shapes import MSO_SHAPE
    sh = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb = RGBColor(*fill)
    if line: sh.line.color.rgb = RGBColor(*line)
    else: sh.line.fill.background()
    sh.shadow.inherit = False
    return sh
```

## 设计规范（做出能看的 PPT，不要纯文字堆砌）
- 配色：主色 + 深灰正文 + 浅色背景块，同一份 PPT 内保持一致。例：主色 `#1F4E79` / `#2E75B6`，强调色 `#ED7D31`，正文 `#333333`，浅底 `#F2F6FA`。
- 页眉：顶部一条细色带或色块（高约 0.6 英寸）+ 标题文字。
- 内容页优先用「卡片 / 三栏 / 两栏对比 / 时间轴 / 数据卡」布局，用矩形色块做底，文字放在色块内。
- 每页文字克制：标题 ≤ 20 字，正文每行 ≤ 若干字，单页要点 3~5 条。需要数据时可插入图表（`chart`）或大号数字卡片。
- 页脚放页码（右下角小字）与简短主题名。
- 结构模板：封面 → 目录 → 内容页（若干）→ 总结/结论 → 结尾页。
- 常见页面类型：封面页、目录页、要点列表页、三栏卡片页、两栏对比页、数据/图表页、时间轴页、结论页、结束页。

## 执行流程
1. 明确主题、受众、页数与要点（信息不足时按常识合理补全，或简短问一句）。
2. 用一次性 heredoc 命令生成 `.pptx`（脚本不落盘到工作区）。
3. 校验文件可打开、页数正确、工作区无多余文件。
4. 回复正文一两句说明即可，文件卡片由系统自动附上。

## 反面清单（不要做）
- ❌ 生成 `outline.md`、`content.json`、`build_ppt.py`、`preview.png` 等中间文件。
- ❌ 在工作区建 `tmp/`、`output/` 之类的目录再放东西。
- ❌ 用 `.ppt`、`.pdf`、`.html`、`.md` 代替 `.pptx` 交付。
- ❌ 在回复里长篇贴出各页正文或脚本代码。
