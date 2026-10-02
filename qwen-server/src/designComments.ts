import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import { readDesign, withLock } from './agent/tools/design.js';
import type { AgentSession } from './agent/tools/types.js';
import { resolvePath } from './agent/tools/workspace.js';

/**
 * Review comments left on prototype elements from the preview page. Stored in a dotfile in the work dir: the
 * preview route never serves dotfiles, and it isn't an output type, so it gets no file card.
 */
const FILE = '.comments.json';

export interface DesignComment {
  id: string;
  pageId: string;
  pageName: string;
  /** Page HTML path in the work dir; the picker matches it against its own location to place badges. */
  html: string;
  selector: string;
  elementName: string;
  content: string;
  author: string;
  createdAt: number;
  /** When the comment was marked 完成; resolved comments lose their badge and sink to the end of the list. */
  resolvedAt?: number;
}

export class CommentError extends Error {}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function listComments(session: AgentSession): Promise<DesignComment[]> {
  const { abs } = await resolvePath(FILE, session);
  try {
    const data = JSON.parse(await fsp.readFile(abs, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function addComment(session: AgentSession, input: Record<string, unknown>, author: string) {
  const content = str(input.content, 2000);
  const selector = str(input.selector, 500);
  const pageId = str(input.pageId, 100);
  if (!content) throw new CommentError('评论内容不能为空');
  if (!selector || !pageId) throw new CommentError('缺少评论的目标元素');

  return withLock(`comments:${session.id}`, async () => {
    const page = (await readDesign(session))?.design.pages.find((p) => p.id === pageId);
    if (!page?.html) throw new CommentError('页面不存在');
    const comment: DesignComment = {
      id: `cm_${crypto.randomBytes(6).toString('hex')}`,
      pageId,
      pageName: page.name,
      html: page.html,
      selector,
      elementName: str(input.elementName, 200) || selector,
      content,
      author,
      createdAt: Date.now(),
    };
    const list = await listComments(session);
    list.push(comment);
    await save(session, list);
    return comment;
  });
}

export async function setCommentResolved(session: AgentSession, id: string, resolved: boolean) {
  return withLock(`comments:${session.id}`, async () => {
    const list = await listComments(session);
    const comment = list.find((c) => c.id === id);
    if (!comment) throw new CommentError('评论不存在');
    if (resolved) comment.resolvedAt ??= Date.now();
    else delete comment.resolvedAt;
    await save(session, list);
    return comment;
  });
}

async function save(session: AgentSession, list: DesignComment[]) {
  await fsp.writeFile((await resolvePath(FILE, session)).abs, JSON.stringify(list, null, 2), 'utf8');
}
