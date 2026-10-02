import { env } from './env.js';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { appConfig, mockSources } from './data/config.js';
import { getWorkspace, guestOwner, login, logout, newId, userByToken, type Workspace } from './store.js';
import { buildHistory, forgetTrace, runAgent } from './agent/loop.js';
import { readDesign } from './agent/tools/design.js';
import { applyDesignStyle, StyleError } from './designStyle.js';
import { parseElementRefs } from './elementRefs.js';
import { addComment, CommentError, listComments, setCommentResolved } from './designComments.js';
import { outputFilePath, readOutputFile } from './agent/tools/files.js';
import { DESIGN_SKILL, getSkill, listSkills } from './skills.js';
import { forgetPreview, previewKey, servePreview } from './preview.js';
import { disposeSession } from './agent/tools/sandbox.js';
import { sessionFor } from './agent/tools/workspace.js';
import { LlmError, resolveModel } from './llm/client.js';
import { buildKeywords, buildReply, buildThinking, defaultHistory, genTitle, needSearch, snippetOf } from './reply.js';
import { isWorkLike, type ChatMode, type Conversation, type Message, type Surface, type User } from './types.js';

const PORT = env.port;
const ID_RE = /^[\w-]{4,48}$/;

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
    token?: string;
    owner: string;
    ws: Workspace;
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function identify(req: Request, _res: Response, next: NextFunction) {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const user = userByToken(token);
  const clientId = req.header('x-client-id');
  if (user) {
    req.user = user;
    req.token = token;
    req.owner = user.id;
  } else if (clientId && ID_RE.test(clientId)) {
    req.owner = guestOwner(clientId);
  } else {
    return next(new HttpError(400, '缺少客户端标识'));
  }
  req.ws = getWorkspace(req.owner);
  next();
}

function findConv(ws: Workspace, id: string) {
  const conv = ws.conversations.find((c) => c.id === id);
  if (!conv) throw new HttpError(404, '对话不存在');
  return conv;
}

const publicConv = ({ temporary: _t, sandboxId: _s, ...c }: Conversation) => c;

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/config', (_req, res) => res.json(appConfig));

app.post('/api/auth/login', (req, res) => {
  const { account = '', password = '' } = req.body ?? {};
  if (!String(account).trim()) throw new HttpError(400, '请输入账号');
  if (String(password).length < 6) throw new HttpError(400, '密码至少 6 位');
  const clientId = req.header('x-client-id');
  res.json(login(String(account).trim(), clientId && ID_RE.test(clientId) ? clientId : undefined));
});

app.get('/api/preview/:key/*', servePreview);

app.use('/api', identify);

app.post('/api/auth/logout', (req, res) => {
  if (req.token) logout(req.token);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) throw new HttpError(401, '未登录');
  res.json(req.user);
});

app.get('/api/conversations', (req, res) => {
  const list = req.ws.conversations.filter((c) => !c.temporary).sort((a, b) => b.updatedAt - a.updatedAt);
  res.json(list.map(publicConv));
});

app.get('/api/conversations/:id/messages', (req, res) => {
  const conv = findConv(req.ws, req.params.id);
  req.ws.messages[conv.id] ??= defaultHistory(conv);
  res.json(req.ws.messages[conv.id]);
});

app.get('/api/skills', (_req, res, next) => {
  listSkills().then((skills) => res.json(skills), next);
});

app.get('/api/conversations/:id/files', (req, res, next) => {
  (async () => {
    const conv = findConv(req.ws, req.params.id);
    const filePath = String(req.query.path ?? '');
    if (!conv.sandboxId || !filePath) throw new HttpError(404, '文件不存在');
    let result;
    try {
      result = await readOutputFile(sessionFor(conv.sandboxId), filePath);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : '读取文件失败');
    }
    if (!result) throw new HttpError(404, '文件不存在或已被删除');
    res.json(result);
  })().catch(next);
});

app.get('/api/conversations/:id/design', (req, res, next) => {
  (async () => {
    const conv = findConv(req.ws, req.params.id);
    const current = conv.sandboxId ? await readDesign(sessionFor(conv.sandboxId)) : undefined;
    if (!current) throw new HttpError(404, '还没有设计画布');
    res.json(current.design);
  })().catch(next);
});

app.post('/api/conversations/:id/design/style', (req, res, next) => {
  (async () => {
    const conv = findConv(req.ws, req.params.id);
    if (!conv.sandboxId) throw new HttpError(404, '还没有设计画布');
    const { page, selector, styles } = req.body ?? {};
    try {
      res.json(await applyDesignStyle(sessionFor(conv.sandboxId), String(page ?? ''), String(selector ?? ''), styles));
    } catch (err) {
      if (err instanceof StyleError) throw new HttpError(400, err.message);
      throw err;
    }
  })().catch(next);
});

app.get('/api/conversations/:id/comments', (req, res, next) => {
  (async () => {
    const conv = findConv(req.ws, req.params.id);
    res.json(conv.sandboxId ? await listComments(sessionFor(conv.sandboxId)) : []);
  })().catch(next);
});

app.post('/api/conversations/:id/comments', (req, res, next) => {
  (async () => {
    const conv = findConv(req.ws, req.params.id);
    if (!conv.sandboxId) throw new HttpError(404, '还没有设计画布');
    try {
      res.json(await addComment(sessionFor(conv.sandboxId), req.body ?? {}, req.user?.name ?? '游客'));
    } catch (err) {
      if (err instanceof CommentError) throw new HttpError(400, err.message);
      throw err;
    }
  })().catch(next);
});

app.patch('/api/conversations/:id/comments/:commentId', (req, res, next) => {
  (async () => {
    const conv = findConv(req.ws, req.params.id);
    if (!conv.sandboxId) throw new HttpError(404, '评论不存在');
    try {
      res.json(await setCommentResolved(sessionFor(conv.sandboxId), req.params.commentId, !!req.body?.resolved));
    } catch (err) {
      if (err instanceof CommentError) throw new HttpError(400, err.message);
      throw err;
    }
  })().catch(next);
});

app.get('/api/conversations/:id/preview', (req, res) => {
  const conv = findConv(req.ws, req.params.id);
  if (!conv.sandboxId) throw new HttpError(404, '对话没有工作区');
  res.json({ key: previewKey(conv.sandboxId) });
});

app.get('/api/conversations/:id/files/download', (req, res, next) => {
  (async () => {
    const conv = findConv(req.ws, req.params.id);
    const filePath = String(req.query.path ?? '');
    if (!conv.sandboxId || !filePath) throw new HttpError(404, '文件不存在');
    let found;
    try {
      found = await outputFilePath(sessionFor(conv.sandboxId), filePath);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : '读取文件失败');
    }
    if (!found) throw new HttpError(404, '文件不存在或已被删除');
    res.download(found.abs, found.file.name);
  })().catch(next);
});

app.patch('/api/conversations/:id', (req, res) => {
  const conv = findConv(req.ws, req.params.id);
  const { title, pinned } = req.body ?? {};
  if (typeof title === 'string') {
    if (!title.trim()) throw new HttpError(400, '标题不能为空');
    conv.title = title.trim().slice(0, 50);
  }
  if (typeof pinned === 'boolean') conv.pinned = pinned;
  res.json(publicConv(conv));
});

app.delete('/api/conversations/:id/messages/:messageId', (req, res) => {
  const conv = findConv(req.ws, req.params.id);
  const list = req.ws.messages[conv.id] ?? [];
  const idx = list.findIndex((m) => m.id === req.params.messageId);
  if (idx < 0) throw new HttpError(404, '消息不存在');
  const start = list[idx].role === 'assistant' && list[idx - 1]?.role === 'user' ? idx - 1 : idx;
  const removed = list.splice(start, idx - start + 1).map((m) => m.id);
  removed.forEach(forgetTrace);
  res.json({ removed });
});

app.delete('/api/conversations/:id', (req, res) => {
  const conv = findConv(req.ws, req.params.id);
  req.ws.conversations = req.ws.conversations.filter((c) => c !== conv);
  req.ws.messages[conv.id]?.forEach((m) => forgetTrace(m.id));
  delete req.ws.messages[conv.id];
  if (conv.sandboxId) {
    forgetPreview(conv.sandboxId);
    disposeSession(sessionFor(conv.sandboxId)).catch((err) => console.error(err));
  }
  res.json({ ok: true });
});

app.get('/api/search', (req, res) => {
  const tab = req.query.tab === 'cloud' ? 'cloud' : 'history';
  const q = String(req.query.q ?? '').trim().slice(0, 50);
  const k = q.toLowerCase();
  if (tab === 'cloud') {
    res.json(req.ws.cloudSpace.filter((it) => !k || it.name.toLowerCase().includes(k)));
    return;
  }
  const convs = req.ws.conversations
    .filter((c) => c.surface === 'daily' && !c.temporary)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const hits = convs.flatMap((conv) => {
    if (!k) return [{ conversation: publicConv(conv) }];
    const body = (req.ws.messages[conv.id] ?? []).map((m) => m.content).join(' ');
    const snippet = snippetOf(body, q);
    return conv.title.toLowerCase().includes(k) || snippet ? [{ conversation: publicConv(conv), snippet }] : [];
  });
  res.json(hits);
});

app.post('/api/chat', (req, res, next) => {
  chat(req, res).catch(next);
});

async function chat(req: Request, res: Response) {
  const body = req.body ?? {};
  const ws = req.ws;
  const mode: ChatMode = body.mode === 'research' ? 'research' : 'fast';
  const model = String(body.model ?? '');
  const assistantId = ID_RE.test(body.assistantMessageId ?? '') ? body.assistantMessageId : newId('a_');
  let conv: Conversation;
  let prompt: string;
  let skill: string | undefined = typeof body.skill === 'string' ? body.skill : undefined;
  let userMessage: Message | undefined;

  if (body.regenerate) {
    conv = findConv(ws, String(body.conversationId));
    const list = (ws.messages[conv.id] ??= []);
    if (list.at(-1)?.role === 'assistant') forgetTrace(list.pop()!.id);
    const lastUser = [...list].reverse().find((m) => m.role === 'user');
    if (!lastUser) throw new HttpError(400, '没有可以重新生成的问题');
    prompt = lastUser.content;
    skill = lastUser.skill;
  } else {
    prompt = String(body.prompt ?? '').trim();
    if (!prompt) throw new HttpError(400, '问题不能为空');
    const convId = String(body.conversationId ?? '');
    const existing = ws.conversations.find((c) => c.id === convId);
    if (existing) {
      conv = existing;
    } else {
      conv = {
        id: ID_RE.test(convId) ? convId : newId('n-'),
        title: genTitle(prompt),
        updatedAt: Date.now(),
        surface: (['work', 'design'].includes(body.surface) ? body.surface : 'daily') as Surface,
        temporary: !!body.temporary,
      };
      ws.conversations.unshift(conv);
      ws.messages[conv.id] = [];
    }
    userMessage = {
      id: ID_RE.test(body.userMessageId ?? '') ? body.userMessageId : newId('u_'),
      role: 'user',
      content: prompt,
      attachments: Array.isArray(body.attachments) ? body.attachments.map(String).slice(0, 10) : [],
      ...(conv.surface === 'design' && parseElementRefs(body.elements).length ? { elements: parseElementRefs(body.elements) } : {}),
      skill,
      createdAt: Date.now(),
    };
    ws.messages[conv.id].push(userMessage);
  }

  const assistant: Message = { id: assistantId, role: 'assistant', content: '', status: 'pending', createdAt: Date.now() };
  ws.messages[conv.id].push(assistant);
  conv.updatedAt = Date.now();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let closed = false;
  res.on('close', () => {
    closed = true;
    if (assistant.status !== 'done') assistant.status = 'stopped';
  });
  const send = (event: string, data: unknown) => {
    if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const target = resolveModel(model);
  if (target) assistant.blocks = [];
  send('start', { conversation: publicConv(conv), userMessage, assistantMessage: assistant });

  if (target) {
    const ctrl = new AbortController();
    res.on('close', () => ctrl.abort());
    if (isWorkLike(conv.surface)) conv.sandboxId ??= newId('sbx_');
    // A skill picked for one message stays active for the rest of the conversation, until another one is picked.
    // Design mode always runs its dedicated skill; work mode uses whatever the user picked.
    const picked = conv.surface === 'work' ? [...ws.messages[conv.id]].reverse().find((m) => m.role === 'user' && m.skill)?.skill : undefined;
    const skillName = conv.surface === 'design' ? DESIGN_SKILL : picked === DESIGN_SKILL ? undefined : picked;
    const agentSkill = skillName ? await getSkill(skillName) : undefined;
    try {
      await runAgent({
        assistant,
        history: buildHistory(ws.messages[conv.id].slice(0, -1)),
        surface: conv.surface,
        target,
        session: conv.sandboxId ? sessionFor(conv.sandboxId) : undefined,
        skill: agentSkill,
        thinking: mode === 'research',
        signal: ctrl.signal,
        emit: (event, data) => {
          if (assistant.status === 'pending') assistant.status = 'streaming';
          send(event, data);
        },
      });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      if (!(err instanceof LlmError)) console.error(err);
      assistant.status = 'stopped';
      send('error', { message: err instanceof LlmError ? err.message : '模型服务异常，请稍后重试' });
      res.end();
      return;
    }
    if (closed) return;
    assistant.status = 'done';
    conv.updatedAt = Date.now();
    send('done', { message: assistant });
    res.end();
    return;
  }

  console.log(`[mock ${assistant.id.slice(-8)}] model=${model || '-'} query=${JSON.stringify(prompt.slice(0, 80))}`);
  const opts = { mode, model, skill };
  await sleep(500);
  if (closed) return;

  if (needSearch(prompt, opts)) {
    assistant.status = 'analyzing';
    assistant.keywords = buildKeywords(prompt);
    send('analyzing', { keywords: assistant.keywords });
    await sleep(700);
    if (closed) return;
    const count = mode === 'research' ? 8 : 3 + Math.floor(Math.random() * 4);
    assistant.sources = mockSources.slice(0, count);
    send('analyzing', { keywords: assistant.keywords, sources: assistant.sources });
    if (mode === 'research') {
      const thinking = buildThinking(prompt);
      for (let i = 0; i < thinking.length; i += 4) {
        if (closed) return;
        assistant.thinking = thinking.slice(0, i + 4);
        send('analyzing', { keywords: assistant.keywords, sources: assistant.sources, thinking: assistant.thinking });
        await sleep(40);
      }
    }
    await sleep(300);
  }

  const reply = buildReply(prompt, opts);
  assistant.status = 'streaming';
  let i = 0;
  while (i < reply.length) {
    if (closed) return;
    const step = 2 + Math.floor(Math.random() * 4);
    const delta = reply.slice(i, i + step);
    assistant.content += delta;
    i += step;
    send('delta', { text: delta });
    await sleep(18);
  }
  assistant.status = 'done';
  conv.updatedAt = Date.now();
  send('done', { message: assistant });
  res.end();
}

app.use('/api', (_req, _res, next) => next(new HttpError(404, '接口不存在')));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error(err);
  if (res.headersSent) return res.end();
  res.status(status).json({ message: status === 500 ? '服务器开小差了，请稍后重试' : err.message });
});

app.listen(PORT, () => {
  console.log(`qwen-server listening on http://127.0.0.1:${PORT}`);
});
