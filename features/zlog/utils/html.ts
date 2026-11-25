export type ContentBlockType = 'h1' | 'h2' | 'h3' | 'p' | 'quote';

export interface ContentBlock {
  type: ContentBlockType;
  text: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…');
}

/**
 * 把接口返回的 contentHtml 转成简单的块级结构，避免引入
 * react-native-render-html。文档说明 App 可优先渲染 contentHtml。
 */
export function htmlToBlocks(html?: string, fallback?: string): ContentBlock[] {
  const src = html || '';
  const blocks: ContentBlock[] = [];

  if (src.trim()) {
    const re = /<(h[1-3]|p|blockquote|li)[^>]*>([\s\S]*?)<\/\1>/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(src))) {
      const tag = match[1].toLowerCase();
      const text = decodeEntities(match[2].replace(/<[^>]+>/g, '')).trim();
      if (!text) continue;
      if (tag === 'h1') blocks.push({ type: 'h1', text });
      else if (tag === 'h2') blocks.push({ type: 'h2', text });
      else if (tag === 'h3') blocks.push({ type: 'h3', text });
      else if (tag === 'blockquote') blocks.push({ type: 'quote', text });
      else if (tag === 'li') blocks.push({ type: 'p', text: `• ${text}` });
      else blocks.push({ type: 'p', text });
    }
  }

  if (!blocks.length) {
    const plain = decodeEntities(
      (fallback || src).replace(/<[^>]+>/g, '\n')
    ).trim();
    if (plain) {
      plain.split(/\n+/).forEach((line) => {
        const t = line.trim();
        if (t) blocks.push({ type: 'p', text: t });
      });
    }
  }

  return blocks;
}

/** 纯文本 → 最简 HTML（发布博客时用） */
export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');
  return paragraphs || '<p></p>';
}
