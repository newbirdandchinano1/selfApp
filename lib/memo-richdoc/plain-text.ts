import { parseMemoBody } from './parse';
import type { MemoRichDoc } from './types';

/** 列表预览 / 搜索 / AI：只抽可见文本，不含 JSON 键名 */
export function plainTextFromRichDoc(doc: MemoRichDoc): string {
  const parts: string[] = [];
  for (const b of doc.doc.blocks) {
    switch (b.type) {
      case 'paragraph':
      case 'heading':
      case 'quote':
      case 'todo':
        parts.push(b.runs.map((r) => r.text).join(''));
        break;
      case 'bullet_list':
      case 'ordered_list':
        for (const it of b.items) parts.push(it.runs.map((r) => r.text).join(''));
        break;
      case 'code':
        parts.push(b.text);
        break;
      case 'image':
        parts.push('[图片]');
        break;
      case 'divider':
        break;
    }
  }
  return parts.join('\n');
}

export function plainTextFromBody(body: string): string {
  return plainTextFromRichDoc(parseMemoBody(body));
}
