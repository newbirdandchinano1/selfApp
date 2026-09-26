/** List 查询参数与 querystring 构建（供 CRUD / 各域 endpoints 共用） */

export type ApiListPagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type ApiListResponse<T> = {
  list: T[];
  pagination: ApiListPagination;
};

/** List API 可选过滤参数（见 CALENDAR_API_FOR_APP.md） */
export type ApiListQueryOpts = {
  page?: number;
  limit?: number;
  includeDeleted?: boolean;
  startDate?: string;
  endDate?: string;
  /** habit_check_ins：按习惯 id 过滤 */
  habitId?: string;
  dueDateGte?: string;
  dueDateLte?: string;
  frogAssignedOnGte?: string;
  frogAssignedOnLte?: string;
  createdAtGte?: string;
  createdAtLte?: string;
  assignedYmdGte?: string;
  assignedYmdLte?: string;
  calendarRelevant?: boolean;
  fields?: string;
  updatedSince?: string;
};

export function buildQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (typeof value === 'boolean') {
      qs.set(key, value ? 'true' : 'false');
      continue;
    }
    if (value === '') continue;
    qs.set(key, String(value));
  }
  const text = qs.toString();
  return text ? `?${text}` : '';
}

export function buildListQuery(opts?: ApiListQueryOpts): string {
  return buildQuery({
    page: opts?.page,
    limit: opts?.limit,
    includeDeleted: opts?.includeDeleted === true,
    startDate: opts?.startDate,
    endDate: opts?.endDate,
    habitId: opts?.habitId,
    dueDateGte: opts?.dueDateGte,
    dueDateLte: opts?.dueDateLte,
    frogAssignedOnGte: opts?.frogAssignedOnGte,
    frogAssignedOnLte: opts?.frogAssignedOnLte,
    createdAtGte: opts?.createdAtGte,
    createdAtLte: opts?.createdAtLte,
    assignedYmdGte: opts?.assignedYmdGte,
    assignedYmdLte: opts?.assignedYmdLte,
    calendarRelevant: opts?.calendarRelevant === true,
    fields: opts?.fields,
    updatedSince: opts?.updatedSince,
  });
}
