/**
 * Phase 2：RichDoc 核心单测（不连库）
 * 运行：npm run test:memo-richdoc
 */
import {
  MEMO_BODY_MAX_BYTES,
  editModelToRichDoc,
  legacyMarkupToRichDoc,
  parseMemoBody,
  plainTextFromBody,
  plainTextFromRichDoc,
  richDocToEditModel,
  serializeEditModelToBody,
  serializeRichDoc,
  validateMemoBody,
  type MemoRichDoc,
  type RichBlock,
} from '../lib/memo-richdoc';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed += 1;
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function runsText(blocks: RichBlock[]): string {
  return plainTextFromRichDoc({
    v: 1,
    format: 'selfapp-richdoc',
    doc: { blocks },
  });
}

function findMarks(doc: MemoRichDoc, needle: string): string[] {
  for (const b of doc.doc.blocks) {
    const runs =
      b.type === 'paragraph' ||
      b.type === 'heading' ||
      b.type === 'quote' ||
      b.type === 'todo'
        ? b.runs
        : b.type === 'bullet_list' || b.type === 'ordered_list'
          ? b.items.flatMap((it) => it.runs)
          : [];
    for (const r of runs) {
      if (r.text.includes(needle)) return r.marks;
    }
  }
  return [];
}

function main() {
  console.log('=== Phase 2: memo-richdoc unit tests ===\n');

  // --- 往返 ---
  console.log('--- serialize(parse(x)) 语义 ---\n');
  const sample: MemoRichDoc = {
    v: 1,
    format: 'selfapp-richdoc',
    doc: {
      blocks: [
        { type: 'heading', level: 1, runs: [{ text: '标题', marks: ['bold'] }] },
        {
          type: 'paragraph',
          runs: [
            { text: '正文', marks: [] },
            { text: '强调', marks: ['italic', 'strike'] },
          ],
        },
        {
          type: 'bullet_list',
          items: [{ indent: 0, runs: [{ text: '条目', marks: [] }] }],
        },
        {
          type: 'todo',
          checked: true,
          indent: 1,
          runs: [{ text: '待办', marks: ['bold'] }],
        },
        { type: 'quote', runs: [{ text: '引用', marks: [] }] },
        { type: 'code', language: 'js', text: 'const x = 1;' },
        { type: 'divider' },
        { type: 'image', uri: 'https://example.com/x.png', width: 10, height: 20 },
      ],
    },
  };
  const serialized = serializeRichDoc(sample);
  const round = parseMemoBody(serialized);
  check('往返后仍是 RichDoc', round.format === 'selfapp-richdoc' && round.v === 1);
  check(
    '往返纯文本一致',
    plainTextFromRichDoc(round) === plainTextFromRichDoc(sample),
    plainTextFromRichDoc(round),
  );
  check('往返 serialize 稳定（二次序列化相同）', serializeRichDoc(round) === serialized);
  check(
    '往返保留 todo checked / indent',
    round.doc.blocks.some(
      (b) => b.type === 'todo' && b.checked === true && b.indent === 1 && b.runs[0]?.text === '待办',
    ),
  );
  check(
    '往返保留 image uri',
    round.doc.blocks.some((b) => b.type === 'image' && b.uri === 'https://example.com/x.png'),
  );

  // --- legacy ---
  console.log('\n--- 旧 markup → RichDoc ---\n');
  const markup = [
    '# 一级 **粗体标题**',
    '正文有**粗体**和[小]小号[/小]与[大]大号[/大]',
    '> 引用 *斜体*',
    '- 无序一',
    '  - 无序二',
    '1. 有序',
    '- [x] 已办',
    '- [ ] 未办',
    '---',
    '```ts',
    'const a = 1;',
    '```',
    '尾段 ~~删除~~',
  ].join('\n');

  const fromLegacy = legacyMarkupToRichDoc(markup);
  check('legacy 产出 RichDoc', fromLegacy.format === 'selfapp-richdoc');
  check(
    'legacy 标题 + 粗体',
    fromLegacy.doc.blocks[0]?.type === 'heading' &&
      findMarks(fromLegacy, '粗体标题').includes('bold'),
  );
  check('legacy 保留粗体正文', findMarks(fromLegacy, '粗体').includes('bold'));
  check(
    'legacy 字号正文不丢（[小]/[大] 剥标签）',
    runsText(fromLegacy.doc.blocks).includes('小号') &&
      runsText(fromLegacy.doc.blocks).includes('大号') &&
      !runsText(fromLegacy.doc.blocks).includes('[小]'),
  );
  check(
    'legacy 嵌套 **[小]x[/小]** 保留粗体+正文',
    (() => {
      const d = legacyMarkupToRichDoc('**[小]嵌套字[/小]**');
      return findMarks(d, '嵌套字').includes('bold') && plainTextFromRichDoc(d).includes('嵌套字');
    })(),
  );
  check(
    'legacy 列表 / 待办 / 引用 / 代码块',
    fromLegacy.doc.blocks.some((b) => b.type === 'bullet_list') &&
      fromLegacy.doc.blocks.some((b) => b.type === 'ordered_list') &&
      fromLegacy.doc.blocks.some((b) => b.type === 'todo' && b.checked) &&
      fromLegacy.doc.blocks.some((b) => b.type === 'quote') &&
      fromLegacy.doc.blocks.some(
        (b) => b.type === 'code' && b.language === 'ts' && b.text.includes('const a'),
      ),
  );
  const legacySerialized = serializeRichDoc(fromLegacy);
  const legacyRound = parseMemoBody(legacySerialized);
  check(
    'legacy → serialize → parse 不丢粗体正文',
    findMarks(legacyRound, '粗体').includes('bold') &&
      plainTextFromRichDoc(legacyRound).includes('小号'),
  );

  // --- 超限 / 非法 / 未知 type ---
  console.log('\n--- validate / 降级 ---\n');
  check(
    '超限 validate 失败',
    !validateMemoBody('x'.repeat(MEMO_BODY_MAX_BYTES + 1)).ok,
  );
  check(
    '非法 JSON（以 { 开头）失败',
    !validateMemoBody('{not-json').ok,
  );
  check(
    '缺 blocks 失败',
    !validateMemoBody(JSON.stringify({ v: 1, format: 'selfapp-richdoc', doc: {} })).ok,
  );
  check(
    'image data-URL 失败',
    !validateMemoBody(
      JSON.stringify({
        v: 1,
        format: 'selfapp-richdoc',
        doc: { blocks: [{ type: 'image', uri: 'data:image/png;base64,AA', width: 0, height: 0 }] },
      }),
    ).ok,
  );
  check('旧 markup validate 通过', validateMemoBody('普通 **粗体**').ok);

  const unknown = parseMemoBody(
    JSON.stringify({
      v: 1,
      format: 'selfapp-richdoc',
      doc: {
        blocks: [
          { type: 'table', runs: [{ text: '表', marks: [] }] },
          { type: 'weird', text: '怪节点' },
          { type: 'paragraph', runs: [{ text: '正常', marks: ['bold', 'unknownMark' as never] }] },
        ],
      },
    }),
  );
  check(
    '未知 type 降级为段落且不抛',
    unknown.doc.blocks.every((b) => b.type === 'paragraph') &&
      plainTextFromRichDoc(unknown).includes('正常'),
  );
  check(
    '未知 mark 被剥离',
    findMarks(unknown, '正常').includes('bold') && !findMarks(unknown, '正常').includes('unknownMark' as never),
  );

  check(
    'plainText 不含 JSON 键名噪声',
    !plainTextFromBody(serialized).includes('selfapp-richdoc') &&
      !plainTextFromBody(serialized).includes('"blocks"'),
  );

  console.log('\n--- Phase 4: edit-bridge ---');
  const editRound = editModelToRichDoc(richDocToEditModel(sample));
  check(
    'edit-bridge 往返保留 heading / todo / image',
    editRound.doc.blocks.some((b) => b.type === 'heading' && b.level === 1) &&
      editRound.doc.blocks.some((b) => b.type === 'todo' && b.checked === true) &&
      editRound.doc.blocks.some((b) => b.type === 'image'),
  );
  const editBody = serializeEditModelToBody(richDocToEditModel(sample));
  check('edit-bridge 保存为 RichDoc JSON', editBody.trimStart().startsWith('{') && editBody.includes('selfapp-richdoc'));
  const withMarks = editModelToRichDoc({
    plain: 'Hi',
    styles: [{ bold: true, italic: true }, { bold: true, italic: true }],
  });
  const hiMarks = (withMarks.doc.blocks[0] as { runs: { marks: string[] }[] }).runs[0]!.marks;
  check('edit-bridge 保留 bold+italic marks', hiMarks.includes('bold') && hiMarks.includes('italic'));

  // --- Phase 5：同步与边界（不连库的契约回归） ---
  console.log('\n--- Phase 5: 边界 / 往返 / AI 纯文本 ---\n');

  const nested: MemoRichDoc = {
    v: 1,
    format: 'selfapp-richdoc',
    doc: {
      blocks: [
        {
          type: 'bullet_list',
          items: [
            { indent: 0, runs: [{ text: '一级', marks: [] }] },
            { indent: 1, runs: [{ text: '二级', marks: [] }] },
            { indent: 2, runs: [{ text: '三级', marks: ['bold'] }] },
          ],
        },
        {
          type: 'todo',
          checked: true,
          indent: 1,
          runs: [{ text: '嵌套待办', marks: [] }],
        },
        { type: 'image', uri: 'https://cdn.example.com/a.png', width: 100, height: 80 },
      ],
    },
  };
  const nestedRound = editModelToRichDoc(richDocToEditModel(nested));
  const nestedList = nestedRound.doc.blocks.find((b) => b.type === 'bullet_list');
  check(
    '多级列表 indent 往返保留',
    nestedList?.type === 'bullet_list' &&
      nestedList.items.some((it) => it.indent === 0 && it.runs[0]?.text === '一级') &&
      nestedList.items.some((it) => it.indent === 1 && it.runs[0]?.text === '二级') &&
      nestedList.items.some((it) => it.indent === 2 && it.runs[0]?.text === '三级'),
  );
  check(
    '待办勾选 + 图片 URI 往返',
    nestedRound.doc.blocks.some(
      (b) => b.type === 'todo' && b.checked === true && b.indent === 1 && b.runs[0]?.text === '嵌套待办',
    ) &&
      nestedRound.doc.blocks.some(
        (b) => b.type === 'image' && b.uri === 'https://cdn.example.com/a.png',
      ),
  );

  const legacyBody = '# 旧标题\n正文 **粗体**\n- [x] 已办';
  const upgraded = serializeEditModelToBody(richDocToEditModel(parseMemoBody(legacyBody)));
  check(
    '旧 markup 新客户端保存升级为 RichDoc',
    upgraded.trimStart().startsWith('{') &&
      upgraded.includes('selfapp-richdoc') &&
      plainTextFromBody(upgraded).includes('旧标题') &&
      plainTextFromBody(upgraded).includes('粗体') &&
      plainTextFromBody(upgraded).includes('已办'),
  );
  check(
    '升级后仍可读（parse 不丢）',
    parseMemoBody(upgraded).format === 'selfapp-richdoc' &&
      parseMemoBody(upgraded).doc.blocks.some((b) => b.type === 'todo' && b.checked),
  );

  // 接近 512KB：合法 RichDoc 校验通过；超限失败且文案可读
  const filler = '字'.repeat(80_000);
  const nearDoc: MemoRichDoc = {
    v: 1,
    format: 'selfapp-richdoc',
    doc: {
      blocks: [{ type: 'paragraph', runs: [{ text: filler, marks: [] }] }],
    },
  };
  const nearBody = serializeRichDoc(nearDoc);
  const nearBytes = Buffer.byteLength(nearBody, 'utf8');
  check(
    '接近上限文档可序列化且 < 512KB',
    nearBytes < MEMO_BODY_MAX_BYTES && validateMemoBody(nearBody).ok,
    `bytes=${nearBytes}`,
  );
  // 再撑大到超限
  const overDoc: MemoRichDoc = {
    v: 1,
    format: 'selfapp-richdoc',
    doc: {
      blocks: [
        {
          type: 'paragraph',
          runs: [{ text: '字'.repeat(200_000), marks: [] }],
        },
      ],
    },
  };
  const overBody = serializeRichDoc(overDoc);
  const overResult = validateMemoBody(overBody);
  check(
    '超限失败且文案含「超过上限」',
    !overResult.ok && overResult.message.includes('超过上限'),
    overResult.ok ? 'unexpected ok' : overResult.message,
  );

  const aiPlain = plainTextFromBody(serializeRichDoc(nested));
  check(
    'AI/预览纯文本不含 JSON 契约键',
    !aiPlain.includes('selfapp-richdoc') &&
      !aiPlain.includes('"blocks"') &&
      !aiPlain.includes('"format"') &&
      aiPlain.includes('一级') &&
      aiPlain.includes('[图片]'),
  );

  console.log(`\n=== ${failed === 0 ? 'ALL PASSED' : 'FAILED'} (${passed} ok / ${failed} fail) ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
