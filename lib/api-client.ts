/**
 * 兼容出口：历史 `@/lib/api-client` import 仍可用。
 * 新代码请按职责从 `@/lib/api/http` / `@/lib/api/endpoints/*` / `@/lib/api/query` 引入。
 */

export {
  APP_API_PREFIX,
  ApiRequestError,
  ApiUnauthorizedError,
  apiLogin,
  apiRequest,
  ensureApiLoggedIn,
  formatApiErrorMessage,
  isApiErrorRetryable,
  isApiResponseSuccess,
  isDuplicateRecordApiError,
  normalizeAppApiPath,
  prepareRowBodyForApi,
  serializeApiErrorForDiagnostic,
} from '@/lib/api/http';

export {
  buildQuery,
  buildListQuery,
  type ApiListPagination,
  type ApiListQueryOpts,
  type ApiListResponse,
} from '@/lib/api/query';

export {
  apiCreateRecord,
  apiUpdateRecord,
  apiPatchRecord,
  apiDeleteRecord,
  apiListRecords,
  apiGetRecord,
  apiGetTablesMeta,
  type ApiTableMetaRow,
} from '@/lib/api/endpoints/crud';

export * from '@/lib/api/endpoints/tasks';
export * from '@/lib/api/endpoints/finance';
export * from '@/lib/api/endpoints/review';
export * from '@/lib/api/endpoints/profile';
export { apiHealthCheck } from '@/lib/api/endpoints/system';
