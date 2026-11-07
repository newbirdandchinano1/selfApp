/**
 * 助手气泡轻量 Markdown 解析（无 RN 依赖，可供脚本单测）。
 */

export type InlineSeg =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'code'; value: string };

export type MdBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string; lang?: string; incomplete?: boolean };

export function parseInlineMarkdown(raw: string): InlineSeg[] {
  const segs: InlineSeg[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (m.index > last) {
      segs.push({ type: 'text', value: raw.slice(last, m.index) });
    }
    const token = m[0];
    if (token.startsWith('**')) {
      segs.push({ type: 'bold', value: token.slice(2, -2) });
    } else {
      segs.push({ type: 'code', value: token.slice(1, -1) });
    }
    last = m.index + token.length;
  }
  if (last < raw.length) {
    segs.push({ type: 'text', value: raw.slice(last) });
  }
  return segs.length ? segs : [{ type: 'text', value: raw }];
}

export function parseMarkdownBlocks(src: string): MdBlock[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    const fenceOpen = /^```([\w+-]*)\s*$/.exec(line);
    if (fenceOpen) {
      const lang = fenceOpen[1] || undefined;
      const body: string[] = [];
      i += 1;
      let closed = false;
      while (i < lines.length) {
        if (/^```\s*$/.test(lines[i] ?? '')) {
          closed = true;
          i += 1;
          break;
        }
        body.push(lines[i] ?? '');
        i += 1;
      }
      blocks.push({
        kind: 'code',
        text: body.join('\n'),
        lang,
        incomplete: !closed,
      });
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'h', level: heading[1].length, text: heading[2].trim() });
      i += 1;
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      const parts: string[] = [quote[1]];
      i += 1;
      while (i < lines.length) {
        const q = /^>\s?(.*)$/.exec(lines[i] ?? '');
        if (!q) break;
        parts.push(q[1]);
        i += 1;
      }
      blocks.push({ kind: 'quote', text: parts.join('\n') });
      continue;
    }

    const ul = /^[-*]\s+(.+)$/.exec(line);
    if (ul) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^[-*]\s+(.+)$/.exec(lines[i] ?? '');
        if (!m) break;
        items.push(m[1].trim());
        i += 1;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    const ol = /^(\d+)\.\s+(.+)$/.exec(line);
    if (ol) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^(\d+)\.\s+(.+)$/.exec(lines[i] ?? '');
        if (!m) break;
        items.push(m[2].trim());
        i += 1;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const paras: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const n = lines[i] ?? '';
      if (!n.trim()) break;
      if (
        /^(#{1,3})\s+/.test(n) ||
        /^[-*]\s+/.test(n) ||
        /^\d+\.\s+/.test(n) ||
        /^>\s?/.test(n) ||
        /^```/.test(n)
      ) {
        break;
      }
      paras.push(n);
      i += 1;
    }
    blocks.push({ kind: 'p', text: paras.join('\n') });
  }
  return blocks;
}
