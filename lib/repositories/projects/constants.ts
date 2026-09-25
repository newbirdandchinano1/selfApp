export const INBOX_PROJECT_CATEGORY_ID = 'project_category_inbox';
export const INBOX_PROJECT_CATEGORY_NAME = '收集箱';

/**
 * 收集箱内完整项目（含任务树）保留天数。
 * 超过后压缩为完成履历并软删项目实体，避免表无限膨胀。
 */
export const INBOX_PROJECT_FULL_RETENTION_DAYS = 90;

/** @deprecated 请用 INBOX_PROJECT_FULL_RETENTION_DAYS */
export const INBOX_PROJECT_RETENTION_DAYS = INBOX_PROJECT_FULL_RETENTION_DAYS;

/** 与任务页一致：无分类或内置收集箱 id 均视为在「收集箱」 */
export function isProjectInInboxCategory(categoryId: string | null | undefined): boolean {
  return !categoryId || categoryId === INBOX_PROJECT_CATEGORY_ID;
}
