/** REST 上传 MySQL 前的表级字段映射（与服务端列名对齐） */

export function mapTableRowForMysqlApiUpload(
  table: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...row };
  delete out.sync_status;

  if (table === 'memo_dimensions') {
    const label =
      (typeof out.name === 'string' ? out.name.trim() : '') ||
      (typeof out.title === 'string' ? out.title.trim() : '') ||
      '未命名维度';
    out.name = label;
    out.title = label;
  }

  /** habit_check_ins.record_date 为逻辑日 YYYY-MM-DD，勿转成 DATETIME */
  if (table === 'habit_check_ins' && typeof out.record_date === 'string') {
    const ymd = out.record_date.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      out.record_date = ymd;
    }
  }

  return out;
}
