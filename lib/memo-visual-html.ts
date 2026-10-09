/**
 * contentEditable HTML 适配（与桌面 memo-visual-html 对齐）。
 * DOM 仅临时；落库必须走 RichDoc。
 */
import type { CharStyle, MemoEditModel } from '@/lib/memo-format';

/** 编辑模型 → contenteditable 用 HTML（行块视觉 + 行内 strong/em/s） */
export function memoModelToEditorHtml(model: MemoEditModel): string {
  if (!model.plain) return '';

  const lines: { text: string; start: number }[] = [];
  let cursor = 0;
  const parts = model.plain.split('\n');
  for (let li = 0; li < parts.length; li++) {
    const text = parts[li]!;
    lines.push({ text, start: cursor });
    cursor += text.length + (li < parts.length - 1 ? 1 : 0);
  }

  return lines
    .map(({ text, start }) => {
      const visual = lineVisualClass(text);
      const prefix = text.slice(0, visual.prefixLen);
      const body = text.slice(visual.prefixLen);
      const bodyHtml = body ? runsToHtml(model, body, start + visual.prefixLen) : '';
      // 空正文放零宽字符占位，便于落光标；序列化时跳过
      const bodyOrZwsp = bodyHtml || '\u200B';
      const hiddenPfx = prefix
        ? `<span class="pfx" hidden>${escapeHtml(prefix)}</span>`
        : '';

      // 待办：真 checkbox；markdown 前缀藏在 .pfx，保证往返仍是 `- [ ] ` / `- [x] `
      if (visual.cls === 'todo') {
        const rest = text.slice((text.match(/^\s*/)?.[0] ?? '').length);
        const checked = /^[-*]\s+\[[xX]\]\s/.test(rest);
        return `<div class="line todo${checked ? ' is-checked' : ''}">${hiddenPfx}<input type="checkbox" class="todo-cb" contenteditable="false"${checked ? ' checked' : ''} /><span class="line-body">${bodyOrZwsp}</span></div>`;
      }
      if (visual.cls === 'bullet') {
        return `<div class="line bullet">${hiddenPfx}<span class="mark" contenteditable="false">•</span><span class="line-body">${bodyOrZwsp}</span></div>`;
      }
      if (visual.cls === 'ordered') {
        const label = prefix.trim() || '1.';
        return `<div class="line ordered">${hiddenPfx}<span class="mark" contenteditable="false">${escapeHtml(label)}</span><span class="line-body">${bodyOrZwsp}</span></div>`;
      }
      if (visual.cls === 'h1' || visual.cls === 'h2' || visual.cls === 'h3' || visual.cls === 'quote') {
        return `<div class="line ${visual.cls}">${hiddenPfx}<span class="line-body">${bodyOrZwsp}</span></div>`;
      }
      // 普通行 / meta：前缀若有则可见（如 ---、```）
      const visiblePfx = prefix ? `<span class="pfx">${escapeHtml(prefix)}</span>` : '';
      return `<div class="line ${visual.cls}">${visiblePfx}${bodyHtml}</div>`;
    })
    .join('');
}

function lineVisualClass(line: string): { cls: string; prefixLen: number } {
  const leading = line.match(/^\s*/)?.[0] ?? '';
  const rest = line.slice(leading.length);
  if (/^###\s/.test(rest)) return { cls: 'h3', prefixLen: leading.length + 4 };
  if (/^##\s/.test(rest)) return { cls: 'h2', prefixLen: leading.length + 3 };
  if (/^#\s/.test(rest)) return { cls: 'h1', prefixLen: leading.length + 2 };
  if (/^>\s/.test(rest)) return { cls: 'quote', prefixLen: leading.length + 2 };
  if (/^[-*]\s+\[[ xX]\]\s/.test(rest)) {
    const m = rest.match(/^[-*]\s+\[[ xX]\]\s/)!;
    return { cls: 'todo', prefixLen: leading.length + m[0].length };
  }
  if (/^[-*]\s/.test(rest)) return { cls: 'bullet', prefixLen: leading.length + 2 };
  if (/^\d+\.\s/.test(rest)) {
    const m = rest.match(/^\d+\.\s/)!;
    return { cls: 'ordered', prefixLen: leading.length + m[0].length };
  }
  if (rest === '---' || rest.startsWith('```')) return { cls: 'meta', prefixLen: 0 };
  return { cls: 'p', prefixLen: 0 };
}

function runsToHtml(model: MemoEditModel, text: string, plainStart: number): string {
  const parts: string[] = [];
  let i = 0;
  while (i < text.length) {
    const style = model.styles[plainStart + i] ?? {};
    let j = i + 1;
    while (
      j < text.length &&
      sameStyle(model.styles[plainStart + j] ?? {}, style)
    ) {
      j += 1;
    }
    parts.push(wrapStyled(escapeHtml(text.slice(i, j)), style));
    i = j;
  }
  return parts.join('');
}

function sameStyle(a: CharStyle, b: CharStyle): boolean {
  return (
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.strike) === Boolean(b.strike) &&
    a.size === b.size
  );
}

function wrapStyled(text: string, style: CharStyle): string {
  let html = text;
  if (style.size === 'small') html = `<span class="memo-size-small">${html}</span>`;
  if (style.size === 'large') html = `<span class="memo-size-large">${html}</span>`;
  if (style.strike) html = `<s>${html}</s>`;
  if (style.italic) html = `<em>${html}</em>`;
  if (style.bold) html = `<strong>${html}</strong>`;
  return html;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function stylesKey(model: MemoEditModel): string {
  let bold = 0;
  let italic = 0;
  let strike = 0;
  let size = 0;
  for (const s of model.styles) {
    if (s.bold) bold += 1;
    if (s.italic) italic += 1;
    if (s.strike) strike += 1;
    if (s.size) size += 1;
  }
  return `${model.styles.length}:${bold}:${italic}:${strike}:${size}`;
}

export type EditorChrome = {
  textColor: string;
  placeholderColor: string;
  caretColor: string;
  backgroundColor: string;
  placeholder: string;
};

/** WebView 壳 HTML（编辑逻辑在页内脚本） */
export function buildMemoEditorDocument(chrome: EditorChrome): string {
  const { textColor, placeholderColor, caretColor, backgroundColor, placeholder } = chrome;
  const ph = escapeHtml(placeholder);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: ${backgroundColor};
    color: ${textColor};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  #editor {
    min-height: 280px;
    padding: 14px;
    outline: none;
    line-height: 1.5;
    font-size: 16px;
    font-weight: 600;
    caret-color: ${caretColor};
    white-space: pre-wrap;
    word-break: break-word;
  }
  #editor:empty:before {
    content: '${ph.replace(/'/g, "\\'")}';
    color: ${placeholderColor};
    font-weight: 600;
    pointer-events: none;
  }
  .line {
    min-height: 1.5em;
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 8px;
  }
  .line.p, .line.meta { display: block; }
  .line.h1 { font-size: 22px; font-weight: 800; line-height: 1.35; }
  .line.h2 { font-size: 19px; font-weight: 800; line-height: 1.4; }
  .line.h3 { font-size: 17px; font-weight: 800; line-height: 1.45; }
  .line.quote {
    border-left: 3px solid ${placeholderColor};
    padding-left: 10px;
    opacity: 0.92;
  }
  .line.meta { color: ${placeholderColor}; font-family: ui-monospace, monospace; font-weight: 500; }
  .pfx { color: ${placeholderColor}; font-size: 16px; font-weight: 600; }
  .line-body { flex: 1; min-width: 0; }
  .mark {
    flex: 0 0 auto;
    color: ${placeholderColor};
    font-weight: 700;
    user-select: none;
    -webkit-user-select: none;
  }
  .todo-cb {
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
    margin: 3px 0 0;
    accent-color: ${caretColor};
  }
  .line.todo.is-checked .line-body {
    text-decoration: line-through;
    opacity: 0.65;
  }
  strong { font-weight: 800; }
  em { font-style: italic; }
  s { text-decoration: line-through; }
  .memo-size-small { font-size: 0.85em; }
  .memo-size-large { font-size: 1.2em; }
</style>
</head>
<body>
<div id="editor" contenteditable="true" spellcheck="false" role="textbox" aria-multiline="true"></div>
<script>
(function () {
  var root = document.getElementById('editor');
  var suppress = false;
  var composing = false;
  /** 点工具栏前 iOS 会清掉选区，必须缓存非折叠 Range */
  var savedRange = null;
  var savedOffsets = { start: 0, end: 0 };

  function post(msg) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
  }

  function editorRootToMemoModel(node, trimTrailing) {
    var plainParts = [];
    var styles = [];
    function walk(n, inherited) {
      if (n.nodeType === 3) {
        var text = n.textContent || '';
        for (var i = 0; i < text.length; i++) {
          var ch = text.charAt(i);
          if (ch === '\\u200B') continue;
          plainParts.push(ch);
          styles.push(Object.assign({}, inherited));
        }
        return;
      }
      if (n.nodeType !== 1) return;
      var el = n;
      var tag = el.tagName.toLowerCase();
      // checkbox / 视觉圆点不进 plain（前缀在隐藏 .pfx 里）
      if (tag === 'input') return;
      if (el.classList && el.classList.contains('mark')) return;
      if (tag === 'br') {
        plainParts.push('\\n');
        styles.push({});
        return;
      }
      if (tag === 'div' || tag === 'p') {
        if (plainParts.length > 0 && plainParts[plainParts.length - 1] !== '\\n') {
          plainParts.push('\\n');
          styles.push({});
        }
      }
      var next = Object.assign({}, inherited);
      if (tag === 'strong' || tag === 'b' || el.style.fontWeight === 'bold' || Number(el.style.fontWeight) >= 700) {
        next.bold = true;
      }
      if (tag === 'em' || tag === 'i' || el.style.fontStyle === 'italic') {
        next.italic = true;
      }
      if (tag === 's' || tag === 'strike' || tag === 'del' ||
          (el.style.textDecorationLine && el.style.textDecorationLine.indexOf('line-through') >= 0) ||
          (el.style.textDecoration && el.style.textDecoration.indexOf('line-through') >= 0)) {
        next.strike = true;
      }
      if (el.classList && el.classList.contains('memo-size-small')) next.size = 'small';
      if (el.classList && el.classList.contains('memo-size-large')) next.size = 'large';
      var children = el.childNodes;
      for (var c = 0; c < children.length; c++) walk(children[c], next);
    }
    walk(node, {});
    if (trimTrailing !== false) {
      while (plainParts.length > 0 && plainParts[plainParts.length - 1] === '\\n') {
        plainParts.pop();
        styles.pop();
      }
    }
    return { plain: plainParts.join(''), styles: styles };
  }

  function emit() {
    if (suppress || composing) return;
    var model = editorRootToMemoModel(root, true);
    post({ type: 'change', model: model });
    postHeight();
  }

  function postHeight() {
    var h = Math.max(280, root.scrollHeight + 8);
    post({ type: 'height', height: h });
  }

  function plainOffsetBefore(container, offset) {
    try {
      var probe = document.createRange();
      probe.selectNodeContents(root);
      probe.setEnd(container, offset);
      var tmp = document.createElement('div');
      tmp.appendChild(probe.cloneContents());
      return editorRootToMemoModel(tmp, false).plain.length;
    } catch (e) {
      return null;
    }
  }

  function getPlainOffsets() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    var range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;
    var start = plainOffsetBefore(range.startContainer, range.startOffset);
    var end = plainOffsetBefore(range.endContainer, range.endOffset);
    if (start == null || end == null) return null;
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }

  function rememberSelection() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    var off = getPlainOffsets();
    if (!off) return;
    if (!sel.isCollapsed) {
      try { savedRange = range.cloneRange(); } catch (e) {}
      savedOffsets = off;
    } else if (off.start === off.end) {
      // 保留光标位置供块级格式（标题/列表）使用
      savedOffsets = off;
    }
    post({ type: 'selection', selection: savedOffsets });
  }

  function restoreSavedRange() {
    root.focus();
    var sel = window.getSelection();
    if (!sel) return false;
    if (savedRange) {
      try {
        sel.removeAllRanges();
        sel.addRange(savedRange);
        return !sel.isCollapsed;
      } catch (e) {}
    }
    if (savedOffsets && savedOffsets.start < savedOffsets.end) {
      setSelectionFromPlainOffsets(savedOffsets);
      return true;
    }
    if (savedOffsets) {
      setSelectionFromPlainOffsets({ start: savedOffsets.start, end: savedOffsets.start });
    }
    return false;
  }

  function locateInFlatEditor(target) {
    var count = 0;
    function walk(node) {
      if (node.nodeType === 3) {
        var text = node.textContent || '';
        for (var i = 0; i < text.length; i++) {
          if (text.charAt(i) === '\\u200B') continue;
          if (count === target) return { node: node, offset: i };
          count += 1;
        }
        return null;
      }
      if (node.nodeType !== 1) return null;
      var el = node;
      var tag = el.tagName.toLowerCase();
      if (tag === 'input') return null;
      if (el.classList && el.classList.contains('mark')) return null;
      if (tag === 'br') {
        if (count === target) {
          var parent = el.parentNode || root;
          var idx = Array.prototype.indexOf.call(parent.childNodes, el);
          return { node: parent, offset: Math.max(0, idx) };
        }
        count += 1;
        return null;
      }
      for (var c = 0; c < el.childNodes.length; c++) {
        var hit = walk(el.childNodes[c]);
        if (hit) return hit;
      }
      return null;
    }
    if (target <= 0) {
      if (root.childNodes.length === 0) return { node: root, offset: 0 };
      var first = root.childNodes[0];
      if (first.nodeType === 3) return { node: first, offset: 0 };
      return { node: root, offset: 0 };
    }
    var found = walk(root);
    if (found) return found;
    return { node: root, offset: root.childNodes.length };
  }

  function setSelectionFromPlainOffsets(selection) {
    var startPos = locateInFlatEditor(selection.start);
    var endPos = locateInFlatEditor(selection.end);
    var sel = window.getSelection();
    if (!sel || !startPos || !endPos) return;
    root.focus();
    var range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    sel.removeAllRanges();
    sel.addRange(range);
    if (!sel.isCollapsed) {
      try { savedRange = range.cloneRange(); } catch (e) {}
    }
    savedOffsets = { start: selection.start, end: selection.end };
  }

  root.addEventListener('compositionstart', function () { composing = true; });
  root.addEventListener('compositionend', function () {
    composing = false;
    emit();
  });
  root.addEventListener('input', emit);
  root.addEventListener('keyup', rememberSelection);
  root.addEventListener('mouseup', rememberSelection);
  root.addEventListener('touchend', rememberSelection);
  document.addEventListener('selectionchange', function () {
    if (suppress) return;
    rememberSelection();
  });

  // 点击 checkbox：同步隐藏前缀 - [ ] / - [x] 并回传模型
  root.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.classList || !t.classList.contains('todo-cb')) return;
    var line = t.closest ? t.closest('.line.todo') : null;
    if (!line) return;
    var pfx = line.querySelector('.pfx');
    if (!pfx) return;
    var raw = pfx.textContent || '';
    var indent = (raw.match(/^\\s*/) || [''])[0];
    var checked = !!t.checked;
    pfx.textContent = indent + (checked ? '- [x] ' : '- [ ] ');
    if (checked) line.classList.add('is-checked');
    else line.classList.remove('is-checked');
    emit();
  });
  // 防止 contentEditable 抢走 checkbox 点击
  root.addEventListener('mousedown', function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('todo-cb')) {
      e.stopPropagation();
    }
  }, true);

  window.__memoEditor = {
    setHtml: function (html) {
      suppress = true;
      root.innerHTML = html || '';
      savedRange = null;
      suppress = false;
      postHeight();
    },
    setSelection: function (selection) {
      suppress = true;
      setSelectionFromPlainOffsets(selection || { start: 0, end: 0 });
      suppress = false;
    },
    focus: function () { root.focus(); },
    /** 行内格式：恢复选区 + execCommand，立刻可见 */
    applyInline: function (cmd) {
      var ok = restoreSavedRange();
      if (!ok) {
        post({ type: 'needSelection' });
        return;
      }
      suppress = true;
      try { document.execCommand(cmd, false, null); } catch (e) {}
      suppress = false;
      try {
        var sel = window.getSelection();
        if (sel && sel.rangeCount) savedRange = sel.getRangeAt(0).cloneRange();
      } catch (e2) {}
      var off = getPlainOffsets();
      if (off) savedOffsets = off;
      emit();
      if (off) post({ type: 'selection', selection: off });
    },
    /** 块级格式：把「缓存选区 + 当前 DOM 模型」交给 RN */
    queryFormatContext: function (token) {
      restoreSavedRange();
      var off = getPlainOffsets() || savedOffsets || { start: 0, end: 0 };
      var model = editorRootToMemoModel(root, true);
      post({ type: 'formatContext', token: token, selection: off, model: model });
    }
  };

  post({ type: 'ready' });
  postHeight();
})();
</script>
</body>
</html>`;
}
