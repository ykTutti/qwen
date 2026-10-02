/**
 * Copies text to the clipboard. The async Clipboard API only exists in secure contexts (https / localhost), so on
 * plain-http deployments this falls back to selecting a hidden textarea and using execCommand('copy').
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('复制失败');
}
