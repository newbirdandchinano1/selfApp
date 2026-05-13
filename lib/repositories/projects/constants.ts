export const INBOX_PROJECT_CATEGORY_ID = 'project_category_inbox';
export const INBOX_PROJECT_CATEGORY_NAME = '收集箱';

/** 进入收集箱后保留天数，超过则自动删除（软删除项目及下属任务） */
export const INBOX_PROJECT_RETENTION_DAYS = 365;

/** 与任务页一致：无分类或内置收集箱 id 均视为在「收集箱」 */
export function isProjectInInboxCategory(categoryId: string | null | undefined): boolean {
  return !categoryId || categoryId === INBOX_PROJECT_CATEGORY_ID;
}
