/**
 * Element picker injected into every previewed HTML page. Preview frames run in an opaque origin, so the parent
 * (design canvas or preview page) cannot touch their DOM; everything goes over postMessage.
 *
 * Parent → page:
 * - `{ type: 'qw-picker', on, attach?, comment?, badges? }` toggles picking. While on, the page's own clicks are
 *   swallowed. `attach: false` hides the 添加到对话 pill; `comment: true` shows a comment box under the picked
 *   element and badges on commented elements; `badges: true` shows the badges even while not picking.
 * - `{ type: 'qw-picker:style', styles }` previews visual-editor edits on the picked element as inline styles.
 * - `{ type: 'qw-picker:clear' }` drops the selection.
 * - `{ type: 'qw-picker:threads', items }` sets the comment threads (all pages; the page keeps its own).
 * - `{ type: 'qw-picker:comment-saved', ok, message? }` answers a submitted comment.
 * - `{ type: 'qw-picker:focus', selector }` scrolls to a commented element and opens its thread.
 * - `{ type: 'qw-picker:describe', id, selector }` asks for an element's current info, answered with
 *   `{ type: 'qw-picker:described', id, element }` (null when it isn't on the page).
 *
 * Page → parent: `qw-picker:pick` (element or null), `qw-picker:attach`, `qw-picker:comment`, `qw-picker:ready`,
 * `qw-picker:thread` (selector of the thread whose popover is open, or null).
 */
import { STYLE_PROPS } from './designStyle.js';

const STYLE_PROP_LIST = [...STYLE_PROPS];

const script = `(() => {
  if (window.parent === window || window.__qwPicker) return;
  window.__qwPicker = true;
  let on = false, attachable = true, commenting = false, badgesOnly = false;
  const showBadges = () => (on && commenting) || badgesOnly;
  let hovered = null, picked = null, boxes = null;
  let threads = [], openThread = null, reportedThread = null, saving = false;
  const FONT = '-apple-system,BlinkMacSystemFont,system-ui,sans-serif';

  const box = (css, ui) => {
    const el = document.createElement('div');
    el.setAttribute('data-qw-picker', '');
    if (ui) el.setAttribute('data-qw-ui', '');
    el.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;display:none;' + css;
    document.documentElement.appendChild(el);
    return el;
  };
  const ensure = () => boxes || (boxes = {
    style: Object.assign(document.createElement('style'), { textContent: '*{cursor:default!important}' }),
    keyframes: document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '@keyframes qw-flash{0%,40%{opacity:1}100%{opacity:0}}' })),
    flash: box('border:2px solid #f59e0b;background:rgba(245,158,11,.16);border-radius:3px;box-shadow:0 0 0 4px rgba(245,158,11,.22)'),
    hover: box('border:1.5px dashed #6e72ff;background:rgba(110,114,255,.08);border-radius:2px'),
    pick: box('border:2px solid #4f46e5;background:rgba(79,70,229,.14);border-radius:2px'),
    tag: box('padding:2px 6px;border-radius:4px;background:#4f46e5;color:#fff;font:500 11px/16px ' + FONT + ';white-space:nowrap'),
    attach: (() => {
      const b = box('pointer-events:auto;cursor:pointer!important;align-items:center;gap:4px;height:26px;padding:0 10px 0 8px;border-radius:13px;background:#4f46e5;color:#fff;font:500 12px/26px ' + FONT + ';white-space:nowrap;box-shadow:0 2px 10px rgba(79,70,229,.4)');
      b.setAttribute('data-qw-attach', '');
      b.title = '把这个元素添加到对话，针对它微调';
      b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/><path d="M12 8v5M9.5 10.5h5"/></svg><span>添加到对话</span>';
      return b;
    })(),
    comment: (() => {
      // A pill like a chat composer: the text grows up to four lines, with a round send button on the right.
      const b = box('pointer-events:auto;align-items:flex-end;gap:8px;width:320px;min-height:52px;padding:7px 7px 7px 20px;border-radius:26px;background:#fff;border:1px solid #e5e6eb;box-shadow:0 6px 24px rgba(30,20,70,.14);font:15px/22px ' + FONT + ';color:#1f2329', true);
      const ta = document.createElement('textarea');
      ta.rows = 1;
      ta.placeholder = '写下你的评论…';
      ta.style.cssText = 'flex:1;min-width:0;height:22px;max-height:88px;margin:8px 0;padding:0;border:0;background:transparent;resize:none;font:inherit;color:inherit;outline:none;overflow-y:auto;cursor:text!important';
      const btn = document.createElement('button');
      btn.title = '发送评论（Enter）';
      btn.setAttribute('aria-label', '发送评论');
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>';
      btn.style.cssText = 'display:flex;flex-shrink:0;align-items:center;justify-content:center;width:38px;height:38px;padding:0;border:0;border-radius:50%;color:#fff;transition:background .15s;cursor:pointer!important';
      const error = document.createElement('div');
      error.style.cssText = 'position:absolute;left:20px;top:100%;margin-top:6px;font-size:12px;line-height:16px;color:#e5484d;white-space:nowrap';
      b.append(ta, btn, error);
      const sync = () => {
        ta.style.height = '22px';
        ta.style.height = Math.max(22, Math.min(ta.scrollHeight, 88)) + 'px';
        const ready = !!ta.value.trim() && !saving;
        btn.disabled = !ready;
        btn.style.background = ready ? '#7c6cf2' : '#c4bbfa';
        btn.style.cursor = ready ? 'pointer' : 'default';
      };
      const submit = () => {
        const content = ta.value.trim();
        if (!content || !picked || saving) return;
        saving = true;
        error.textContent = '';
        sync();
        parent.postMessage({ type: 'qw-picker:comment', element: info(picked), path: location.pathname, content }, '*');
      };
      btn.addEventListener('click', submit);
      ta.addEventListener('input', () => { error.textContent = ''; sync(); render(); });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
      });
      b._ta = ta; b._sync = sync; b._error = (msg) => { saving = false; error.textContent = msg; sync(); };
      return b;
    })(),
    popover: box('pointer-events:auto;flex-direction:column;width:260px;max-height:300px;overflow:auto;border-radius:12px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.08),0 8px 28px rgba(30,20,70,.18);font:13px/1.5 ' + FONT + ';color:#1f2329', true),
    badges: new Map(),
  });
  const mine = (el) => !el || el.nodeType !== 1 || el === document.documentElement || !!el.closest('[data-qw-picker]');
  const isUi = (el) => !!(el && el.closest && el.closest('[data-qw-ui]'));
  const name = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2) : [];
    return cls.length ? s + '.' + cls.join('.') : s;
  };
  const selector = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let part = n.tagName.toLowerCase();
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const find = (sel) => { try { return document.querySelector(sel); } catch { return null; } };
  const time = (t) => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const here = () => { try { return decodeURIComponent(location.pathname); } catch { return location.pathname; } };
  const pageThreads = () => threads.filter((t) => here().endsWith('/' + t.html));

  const place = (b, el) => {
    if (!el || !el.isConnected) { b.style.display = 'none'; return null; }
    const r = el.getBoundingClientRect();
    Object.assign(b.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    return r;
  };
  /** Puts a floating control under the picked element (flipping above near the bottom), aligned left or right. */
  const placeUnder = (b, align, gap) => {
    const r = picked.getBoundingClientRect();
    const w = b.offsetWidth, h = b.offsetHeight;
    const below = r.bottom + gap;
    const top = below + h <= innerHeight - 4 ? below : Math.max(4, r.top - h - gap);
    const left = align === 'right' ? r.right - w : r.left;
    Object.assign(b.style, { left: Math.max(4, Math.min(left, innerWidth - w - 4)) + 'px', top: top + 'px' });
  };
  const render = () => {
    if (!boxes) return;
    place(boxes.pick, picked);
    place(boxes.flash, on || badgesOnly ? flashEl : null);
    const target = hovered && hovered !== picked ? hovered : picked;
    const r = place(boxes.hover, hovered && hovered !== picked ? hovered : null) || (picked && picked.getBoundingClientRect());
    const live = on && picked && picked.isConnected;
    boxes.attach.style.display = live && attachable && !commenting ? 'flex' : 'none';
    if (boxes.attach.style.display !== 'none') placeUnder(boxes.attach, 'right', picked.getBoundingClientRect().top < 22 ? 26 : 6);
    boxes.comment.style.display = live && commenting ? 'flex' : 'none';
    if (boxes.comment.style.display !== 'none') placeUnder(boxes.comment, 'left', picked.getBoundingClientRect().top < 22 ? 26 : 8);
    renderBadges();
    if (!target || !r) boxes.tag.style.display = 'none';
    else {
      boxes.tag.textContent = name(target) + '  ' + Math.round(r.width) + '×' + Math.round(r.height);
      Object.assign(boxes.tag.style, { display: 'block', left: Math.max(0, r.left) + 'px', top: (r.top >= 22 ? r.top - 22 : r.bottom + 4) + 'px' });
    }
  };

  /** Whether a viewport point is cut off by a scrolling/clipping ancestor of el (up to the page itself). */
  const clippedAt = (el, x, y) => {
    for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/auto|scroll|hidden|clip/.test(cs.overflowX + cs.overflowY)) {
        const c = n.getBoundingClientRect();
        if (x < c.left - 1 || x > c.right + 1 || y < c.top - 1 || y > c.bottom + 1) return true;
      }
      if (cs.position === 'fixed') break;
    }
    return false;
  };
  const pinned = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const p = getComputedStyle(n).position;
      if (p === 'fixed' || p === 'sticky') return true;
    }
    return false;
  };
  // Badges live in page coordinates so they scroll with their element. Elements in fixed/sticky boxes don't move
  // with the page, so their badges go fixed and follow on every scroll. A badge hides with its element: not
  // rendered, or its corner scrolled out of an inner scroll container.
  const placeBadge = (b, el) => {
    const r = el.getBoundingClientRect();
    const hidden = !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden' || clippedAt(el, r.right, r.top);
    if (hidden) { b.style.display = 'none'; return; }
    b.style.display = 'flex';
    const left = Math.max(2, Math.min(r.right - 12, document.documentElement.clientWidth - 26));
    if (pinned(el)) {
      Object.assign(b.style, { position: 'fixed', left: left + 'px', top: Math.max(2, r.top - 12) + 'px' });
    } else {
      const doc = document.documentElement.getBoundingClientRect();
      Object.assign(b.style, { position: 'absolute', left: left - doc.left + 'px', top: Math.max(2, r.top - 12 - doc.top) + 'px' });
    }
  };

  // Comment badges sit on each commented element's top-right corner; only while picking in comment mode.
  const renderBadges = () => {
    const show = showBadges();
    const list = show ? pageThreads() : [];
    const keep = new Set();
    for (const t of list) {
      const el = find(t.selector);
      if (!el) continue;
      keep.add(t.selector);
      let b = boxes.badges.get(t.selector);
      if (!b) {
        b = box('pointer-events:auto;cursor:pointer!important;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;border-radius:11px 11px 11px 2px;background:#f59e0b;color:#fff;border:2px solid #fff;font:600 11px/1 ' + FONT + ';box-shadow:0 2px 8px rgba(0,0,0,.2)', true);
        b.setAttribute('data-qw-badge', t.selector);
        boxes.badges.set(t.selector, b);
      }
      b.textContent = String(t.comments.length);
      b.title = t.comments.length + ' 条评论';
      placeBadge(b, el);
    }
    for (const [sel, b] of boxes.badges) if (!keep.has(sel)) { b.remove(); boxes.badges.delete(sel); }
    renderPopover();
  };
  const renderPopover = () => {
    const p = boxes.popover;
    const t = openThread && showBadges() ? pageThreads().find((x) => x.selector === openThread) : null;
    const badge = t && boxes.badges.get(t.selector);
    const shown = t && badge ? t.selector : null;
    if (shown !== reportedThread) {
      reportedThread = shown;
      parent.postMessage({ type: 'qw-picker:thread', selector: shown }, '*');
    }
    if (!t || !badge || badge.style.display === 'none') { p.style.display = 'none'; return; }
    if (p._for !== t.selector || p._count !== t.comments.length) {
      p.replaceChildren();
      const head = document.createElement('div');
      head.style.cssText = 'padding:10px 12px 6px;font-size:12px;color:#8f959e;border-bottom:1px solid #f0f1f5';
      head.textContent = t.comments.length + ' 条评论 · ' + t.elementName;
      p.append(head);
      for (const c of t.comments) {
        const item = document.createElement('div');
        item.style.cssText = 'padding:8px 12px;border-bottom:1px solid #f5f6f8';
        const meta = document.createElement('div');
        meta.style.cssText = 'font-size:12px;color:#8f959e;margin-bottom:2px';
        meta.textContent = c.author + ' · ' + time(c.createdAt);
        const body = document.createElement('div');
        body.style.cssText = 'white-space:pre-wrap;word-break:break-word';
        body.textContent = c.content;
        item.append(meta, body);
        p.append(item);
      }
      p._for = t.selector;
      p._count = t.comments.length;
    }
    p.style.display = 'flex';
    const r = badge.getBoundingClientRect();
    const w = p.offsetWidth, h = p.offsetHeight;
    const top = r.bottom + 6 + h <= innerHeight - 4 ? r.bottom + 6 : Math.max(4, r.top - h - 6);
    Object.assign(p.style, { left: Math.max(4, Math.min(r.left - 8, innerWidth - w - 4)) + 'px', top: top + 'px' });
  };

  const PROPS = ${JSON.stringify(STYLE_PROP_LIST)};
  const info = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      selector: selector(el), name: name(el), tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.textContent || '').trim().slice(0, 200),
      rect: { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height },
      styles: Object.fromEntries(PROPS.map((p) => [p, cs.getPropertyValue(p)])),
    };
  };
  const send = (el) => parent.postMessage({ type: 'qw-picker:pick', element: el && info(el) }, '*');

  // Jumping to a comment: pages often render with JS after load, so wait briefly for the element to appear.
  let focusTimer = 0, flashTimer = 0, flashEl = null;
  const focus = (sel) => {
    clearTimeout(focusTimer);
    const started = Date.now();
    const attempt = () => {
      const el = find(sel);
      if (!el) {
        if (Date.now() - started < 3000) focusTimer = setTimeout(attempt, 100);
        return;
      }
      if (picked) select(null);
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      openThread = sel;
      flashEl = el;
      clearTimeout(flashTimer);
      ensure().flash.style.animation = 'none';
      void boxes.flash.offsetWidth;
      boxes.flash.style.animation = 'qw-flash 1.6s ease-out forwards';
      flashTimer = setTimeout(() => { flashEl = null; render(); }, 1600);
      render();
      // Smooth scrolling moves the element after this frame; follow it until it settles.
      let frames = 0;
      const follow = () => { render(); if (++frames < 40) requestAnimationFrame(follow); };
      requestAnimationFrame(follow);
    };
    attempt();
  };
  const resetComment = () => {
    if (!boxes) return;
    boxes.comment._ta.value = '';
    boxes.comment._error('');
  };
  const select = (el) => {
    picked = el;
    hovered = null;
    openThread = null;
    resetComment();
    render();
    send(picked);
    if (picked && commenting) setTimeout(() => boxes.comment._ta.focus(), 0);
  };

  // The page's own handlers never see presses while picking, except inside our comment box and popover.
  const swallow = (e) => { if (on && !isUi(e.target)) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); } };
  for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu', 'submit', 'touchstart', 'touchend']) {
    window.addEventListener(type, swallow, true);
  }
  window.addEventListener('mousemove', (e) => {
    if (!on) return;
    hovered = mine(e.target) ? null : e.target;
    render();
  }, true);
  document.addEventListener('mouseleave', () => { if (on) { hovered = null; render(); } });
  let flash = 0;
  window.addEventListener('click', (e) => {
    const badge = e.target.closest && e.target.closest('[data-qw-badge]');
    if (badge) {
      e.preventDefault();
      e.stopPropagation();
      const sel = badge.getAttribute('data-qw-badge');
      openThread = openThread === sel ? null : sel;
      render();
      return;
    }
    if (isUi(e.target)) return;
    if (!on) {
      // Badges-only mode keeps the page interactive; a click elsewhere just closes the open thread.
      if (openThread) { openThread = null; render(); }
      return;
    }
    swallow(e);
    if (e.target.closest && e.target.closest('[data-qw-attach]')) {
      if (!picked) return;
      // Fresh info, so styles edited in the visual editor since picking are included.
      parent.postMessage({ type: 'qw-picker:attach', element: info(picked) }, '*');
      const label = boxes.attach.querySelector('span');
      label.textContent = '已添加 ✓';
      clearTimeout(flash);
      flash = setTimeout(() => { label.textContent = '添加到对话'; render(); }, 1200);
      render();
      return;
    }
    if (mine(e.target)) return;
    select(e.target);
  }, true);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (openThread) { openThread = null; render(); }
    else if (on && picked) select(null);
  }, true);
  window.addEventListener('scroll', render, true);
  window.addEventListener('resize', render);
  window.addEventListener('message', (e) => {
    if (e.source !== parent || !e.data) return;
    const d = e.data;
    if (d.type === 'qw-picker:style') {
      if (!picked) return;
      for (const [p, v] of Object.entries(d.styles || {})) {
        if (!PROPS.includes(p)) continue;
        v ? picked.style.setProperty(p, String(v), 'important') : picked.style.removeProperty(p);
      }
      render();
      return;
    }
    if (d.type === 'qw-picker:clear') { if (picked) select(null); return; }
    if (d.type === 'qw-picker:threads') {
      threads = Array.isArray(d.items) ? d.items : [];
      if (boxes) boxes.popover._count = -1;
      render();
      return;
    }
    if (d.type === 'qw-picker:comment-saved') {
      if (!boxes) return;
      if (d.ok) {
        const sel = picked && selector(picked);
        select(null);
        openThread = sel;
        render();
      } else {
        boxes.comment._error(d.message || '提交失败，请重试');
      }
      return;
    }
    if (d.type === 'qw-picker:focus') { focus(String(d.selector || '')); return; }
    if (d.type === 'qw-picker:describe') {
      const el = find(String(d.selector || ''));
      parent.postMessage({ type: 'qw-picker:described', id: d.id, element: el && info(el) }, '*');
      return;
    }
    if (d.type !== 'qw-picker') return;
    on = !!d.on;
    attachable = d.attach !== false;
    commenting = !!d.comment;
    badgesOnly = !!d.badges;
    const b = ensure();
    if (on) document.head.appendChild(b.style);
    else { b.style.remove(); hovered = null; if (picked) select(null); }
    if (!showBadges()) openThread = null;
    render();
    parent.postMessage({ type: 'qw-picker:ready', path: location.pathname }, '*');
  });
})();`;

export function injectPicker(html: string) {
  const tag = `<script data-qw-picker>${script}</script>`;
  const at = html.search(/<\/body>/i);
  return at === -1 ? html + tag : html.slice(0, at) + tag + html.slice(at);
}
