/**
 * 单条 KV 值体积有限制；超大表拆成多段 `*.partNNN.json` 上传。
 */

export const MAX_GITHUB_SQLITE_JSON_UTF8_BYTES = 950 * 1024;

export function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export type SqliteTableUploadPiece = {
  path: string;
  body: string;
  commitSuffix: string;
  manifestRowCount: number;
};

function chunkBody(
  table: string,
  lastUpdated: string,
  chunkIndex: number,
  chunkCount: number,
  slice: unknown[],
): string {
  return JSON.stringify(
    {
      schema: 'sqlite-table-dump-chunk/v1' as const,
      table,
      lastUpdated,
      chunkIndex,
      chunkCount,
      rowCount: slice.length,
      rows: slice,
    },
    null,
    2,
  );
}

function singleBody(table: string, lastUpdated: string, rows: unknown[]): string {
  return JSON.stringify(
    {
      schema: 'sqlite-table-dump/v1' as const,
      table,
      lastUpdated,
      rowCount: rows.length,
      rows,
    },
    null,
    2,
  );
}

/**
 * 将单表行集拆成若干不超过 {@link MAX_GITHUB_SQLITE_JSON_UTF8_BYTES} 的 JSON 文件描述。
 * 若单行即超过上限，返回 `error` 由调用方写入 sqliteTableErrors。
 */
export function buildSqliteTableUploadPieces(
  root: string,
  table: string,
  lastUpdated: string,
  rows: unknown[],
): { ok: true; pieces: SqliteTableUploadPiece[] } | { ok: false; error: string } {
  const single = singleBody(table, lastUpdated, rows);
  if (utf8ByteLength(single) <= MAX_GITHUB_SQLITE_JSON_UTF8_BYTES) {
    return {
      ok: true,
      pieces: [
        {
          path: `${root}/sqlite/${table}.json`,
          body: single,
          commitSuffix: `sqlite/${table}.json`,
          manifestRowCount: rows.length,
        },
      ],
    };
  }

  const PLACEHOLDER_CHUNK_COUNT = 999;

  const sizeWithPlaceholderCount = (slice: unknown[]): number => {
    return utf8ByteLength(chunkBody(table, lastUpdated, 0, PLACEHOLDER_CHUNK_COUNT, slice));
  };

  const batches: unknown[][] = [];
  let cur: unknown[] = [];

  for (const row of rows) {
    const tryRows = [...cur, row];
    if (sizeWithPlaceholderCount(tryRows) > MAX_GITHUB_SQLITE_JSON_UTF8_BYTES && cur.length > 0) {
      batches.push(cur);
      cur = [row];
    } else {
      cur = tryRows;
    }
    if (cur.length === 1) {
      const oneBody = singleBody(table, lastUpdated, cur);
      if (utf8ByteLength(oneBody) > MAX_GITHUB_SQLITE_JSON_UTF8_BYTES) {
        return {
          ok: false,
          error: `存在单行 JSON 体积过大，超过 GitHub 单文件上限（约 ${Math.round(MAX_GITHUB_SQLITE_JSON_UTF8_BYTES / 1024)}KB），无法备份该表`,
        };
      }
    }
  }
  if (cur.length > 0) batches.push(cur);

  const chunkCount = batches.length;
  const pieces: SqliteTableUploadPiece[] = batches.map((slice, i) => {
    const body = chunkBody(table, lastUpdated, i, chunkCount, slice);
    const suffix = String(i).padStart(3, '0');
    return {
      path: `${root}/sqlite/${table}.part${suffix}.json`,
      body,
      commitSuffix: `sqlite/${table}.part${suffix}.json`,
      manifestRowCount: slice.length,
    };
  });
  for (const p of pieces) {
    if (utf8ByteLength(p.body) > MAX_GITHUB_SQLITE_JSON_UTF8_BYTES) {
      return {
        ok: false,
        error: `表「${table}」分片后仍有文件超过上限，请精简数据或联系开发者`,
      };
    }
  }

  return { ok: true, pieces };
}

/** 从仓库路径解析表名与分片序号（`table.json` / `table.part000.json`）。 */
export function parseSqliteBackupRepoPath(repoPath: string): { table: string; partIndex: number | null } {
  const base = repoPath.split('/').pop() ?? '';
  const mPart = /^(.+)\.part(\d+)\.json$/i.exec(base);
  if (mPart) {
    const idx = Number.parseInt(mPart[2]!, 10);
    return { table: mPart[1]!, partIndex: Number.isFinite(idx) ? idx : 0 };
  }
  const mJson = /^(.+)\.json$/i.exec(base);
  if (mJson) return { table: mJson[1]!, partIndex: null };
  throw new Error(`无法解析 sqlite 备份路径：${repoPath}`);
}
