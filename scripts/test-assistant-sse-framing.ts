/**
 * SSE 分帧 / CRLF / 多 data 行容错：确认卡事件不能因网关改行尾而整包丢失。
 *
 * 运行：npx tsx scripts/test-assistant-sse-framing.ts
 */
import assert from 'node:assert/strict';

import {
  feedSseBuffer,
  normalizeSseNewlines,
  parseSseChunk,
} from '../lib/assistant/chat-sse';

function collect(raw: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  parseSseChunk(raw, ev => out.push(ev));
  return out;
}

function main() {
  assert.equal(normalizeSseNewlines('a\r\nb\rc'), 'a\nb\nc');

  // LF 正常分帧
  {
    const events: Record<string, unknown>[] = [];
    let buf = '';
    buf = feedSseBuffer(
      buf,
      'event: card\ndata: {"event":"card","card":{"id":"c1","title":"置顶备忘"}}\n\n',
      ev => events.push(ev),
    );
    buf = feedSseBuffer(
      buf,
      'event: tool_result\ndata: {"event":"tool_result","summary":"确认卡：更新备忘","card":{"id":"c1"}}\n\n',
      ev => events.push(ev),
    );
    assert.equal(buf, '');
    assert.equal(events.length, 2);
    assert.equal(events[0].event, 'card');
    assert.equal((events[0].card as { id: string }).id, 'c1');
    assert.equal(events[1].event, 'tool_result');
  }

  // CRLF 分帧（网关常见）
  {
    const events: Record<string, unknown>[] = [];
    let buf = '';
    buf = feedSseBuffer(
      buf,
      'event: cards\r\ndata: {"event":"cards","cards":[{"id":"c2","confirm_action":"commit_memo"}]}\r\n\r\n',
      ev => events.push(ev),
    );
    assert.equal(buf, '');
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'cards');
    assert.equal((events[0].cards as unknown[]).length, 1);
  }

  // 半包：先到一半，再补齐
  {
    const events: Record<string, unknown>[] = [];
    let buf = '';
    buf = feedSseBuffer(buf, 'event: done\ndata: {"event":"done","reply":"ok"', ev =>
      events.push(ev),
    );
    assert.equal(events.length, 0);
    buf = feedSseBuffer(buf, ',"cards":[]}\n\n', ev => events.push(ev));
    assert.equal(buf, '');
    assert.equal(events.length, 1);
    assert.equal(events[0].reply, 'ok');
  }

  // 多事件被揉进一块时的自救（逐 data 行）
  {
    const jammed =
      'data: {"event":"card","card":{"id":"a"}}\n' +
      'data: {"event":"tool_result","summary":"确认卡：新建备忘"}\n';
    const events = collect(jammed);
    assert.equal(events.length, 2);
    assert.equal(events[0].event, 'card');
    assert.equal(events[1].event, 'tool_result');
  }

  console.log('test-assistant-sse-framing: ok');
}

main();
