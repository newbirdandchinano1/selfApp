/** 与任务页「待办」区一致：未挂项目、无父任务；「任务列表」四象限项不计入待办总览 */
export const TASK_OVERVIEW_SCOPE_WHERE = `
  (project_id IS NULL OR TRIM(project_id) = '')
  AND (parent_task_id IS NULL OR TRIM(parent_task_id) = '')
`;

/** 执行事件仅统计属于上述待办范围的任务 */
export const TASK_OVERVIEW_EVENT_SCOPE_WHERE = `
  (t.project_id IS NULL OR TRIM(t.project_id) = '')
  AND (t.parent_task_id IS NULL OR TRIM(t.parent_task_id) = '')
`;
