/**
 * S9.7：ConfirmCard 分域字段模板。
 * 统一基础设施（DraftField + deriveDraftFields）；按 confirm_action / domain 展示中文标签与可编辑性。
 */

export type DraftFieldSpec = {
  key: string;
  label: string;
  editable?: boolean;
  /** draft 中等价键（按顺序取第一个有值的） */
  aliases?: string[];
  /** 无值也展示（如新建菜谱必须选手动分类） */
  forceShow?: boolean;
  /** ConfirmCard 输入形态；select 由卡片侧拉现有选项 */
  input?: 'text' | 'select';
};

/** 通用键 → 中文标签（无模板时的兜底） */
export const COMMON_FIELD_LABELS: Record<string, string> = {
  name: '标题',
  title: '标题',
  amount: '金额',
  category_label: '分类',
  category_name: '分类',
  account_name: '账户',
  payment_account_label: '账户',
  from_account_name: '转出账户',
  to_account_name: '转入账户',
  transaction_type: '类型',
  note: '备注',
  body: '正文',
  content: '正文',
  food_summary: '食物',
  food_name: '食物',
  calories_kcal: '热量(kcal)',
  protein_g: '蛋白(g)',
  carbohydrate_g: '碳水(g)',
  fat_g: '脂肪(g)',
  hydration_ml: '饮水(ml)',
  due_ymd: '截止日期',
  date: '日期',
  occurred_at: '日期',
  txn_date: '日期',
  weight_kg: '体重(kg)',
  points: '积分',
  cost_points: '积分',
  wish_type: '类型',
  color: '颜色',
  brand: '品牌',
  season: '季节',
  category: '分类',
  frequency: '频率',
  context_name: '场景',
  habit_name: '习惯',
  recipe_name: '菜谱',
  servings: '份量',
  day_of_month: '每月几号',
  budget_amount: '预算金额',
  month: '月份',
  direction: '方向',
  status: '状态',
  scope: '范围',
  column_key: '栏位',
  text: '内容',
  persona: '画像',
  display_name: '昵称',
  tag_name: '标签',
  plan_name: '计划名',
  target_amount: '目标金额',
  deposit_amount: '存入金额',
};

/**
 * 分域 confirm_action → 有序字段模板。
 * 未列出的 commit_* 走 COMMON_FIELD_LABELS + 通用 preferKeys。
 */
export const CONFIRM_CARD_FIELD_TEMPLATES: Record<string, DraftFieldSpec[]> = {
  commit_catalog_write: [
    { key: '_catalog_operation_id', label: '操作', editable: false },
    { key: '_http_method', label: '方法', editable: false },
    { key: '_http_path', label: '接口', editable: false },
    { key: 'name', label: '标题', editable: true, aliases: ['title'] },
    { key: 'amount', label: '金额', editable: true },
    { key: 'note', label: '备注', editable: true },
    { key: 'id', label: '目标ID', editable: true },
  ],
  commit_finance_txn: [
    { key: 'name', label: '标题', editable: true },
    { key: 'amount', label: '金额', editable: true },
    { key: 'transaction_type', label: '类型', editable: true },
    { key: 'category_label', label: '分类', editable: true, aliases: ['category_name'] },
    {
      key: 'account_name',
      label: '账户',
      editable: true,
      aliases: ['payment_account_label'],
    },
    { key: 'occurred_at', label: '日期', editable: true, aliases: ['date', 'txn_date'] },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_finance_transfer: [
    { key: 'amount', label: '金额', editable: true },
    {
      key: 'from_account_name',
      label: '转出账户',
      editable: true,
      aliases: ['from_account', 'source_account_name'],
    },
    {
      key: 'to_account_name',
      label: '转入账户',
      editable: true,
      aliases: ['to_account', 'target_account_name'],
    },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_finance_scheduled: [
    { key: 'name', label: '标题', editable: true },
    { key: 'amount', label: '金额', editable: true },
    { key: 'day_of_month', label: '每月几号', editable: true, aliases: ['day'] },
    {
      key: 'account_name',
      label: '账户',
      editable: true,
      aliases: ['payment_account_label'],
    },
    { key: 'category_label', label: '分类', editable: true },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_finance_cash_flow: [
    { key: 'name', label: '标题', editable: true, aliases: ['title', 'label'] },
    { key: 'amount', label: '金额', editable: true },
    { key: 'kind', label: '类型', editable: true, aliases: ['flow_kind', 'category'] },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_finance_budget: [
    { key: 'month', label: '月份', editable: true },
    { key: 'budget_amount', label: '预算金额', editable: true, aliases: ['amount', 'total'] },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_finance_account: [
    { key: 'name', label: '账户名', editable: true },
    { key: 'account_type', label: '类型', editable: true, aliases: ['type'] },
    { key: 'opening_balance', label: '初始余额', editable: true, aliases: ['balance'] },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_finance_flow_category: [
    { key: 'name', label: '分类名', editable: true },
    { key: 'kind', label: '流向', editable: true, aliases: ['flow_kind'] },
  ],
  commit_finance_account_type: [
    { key: 'name', label: '类型名', editable: true },
  ],
  commit_savings_plan: [
    { key: 'name', label: '计划名', editable: true, aliases: ['plan_name', 'title'] },
    { key: 'target_amount', label: '目标金额', editable: true, aliases: ['amount'] },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_savings_deposit: [
    { key: 'plan_name', label: '计划', editable: true, aliases: ['name', 'title'] },
    { key: 'deposit_amount', label: '存入金额', editable: true, aliases: ['amount'] },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_task: [
    { key: 'title', label: '标题', editable: true, aliases: ['name'] },
    { key: 'due_ymd', label: '截止日期', editable: true, aliases: ['due_date', 'date'] },
    { key: 'priority', label: '优先级', editable: true },
    { key: 'note', label: '备注', editable: true, aliases: ['body', 'content'] },
  ],
  commit_project: [
    { key: 'title', label: '项目名', editable: true, aliases: ['name'] },
    { key: 'note', label: '说明', editable: true, aliases: ['body', 'description'] },
  ],
  commit_task_category: [
    { key: 'name', label: '分类名', editable: true, aliases: ['title'] },
  ],
  commit_project_category: [
    { key: 'name', label: '分类名', editable: true, aliases: ['title'] },
  ],
  commit_habit: [
    { key: 'name', label: '习惯名', editable: true, aliases: ['title'] },
    { key: 'frequency', label: '频率', editable: true },
    { key: 'context_name', label: '场景', editable: true, aliases: ['context'] },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_habit_checkin: [
    { key: 'habit_name', label: '习惯', editable: true, aliases: ['name', 'title'] },
    { key: 'date', label: '日期', editable: true, aliases: ['checkin_ymd', 'ymd'] },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_habit_context: [
    { key: 'name', label: '场景名', editable: true, aliases: ['title'] },
  ],
  commit_food_intake: [
    {
      key: 'food_summary',
      label: '食物',
      editable: true,
      aliases: ['food_name', 'name', 'title'],
    },
    { key: 'calories_kcal', label: '热量(kcal)', editable: true },
    { key: 'protein_g', label: '蛋白(g)', editable: true },
    { key: 'carbohydrate_g', label: '碳水(g)', editable: true },
    { key: 'fat_g', label: '脂肪(g)', editable: true },
    { key: 'hydration_ml', label: '饮水(ml)', editable: true },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_weight: [
    { key: 'weight_kg', label: '体重(kg)', editable: true, aliases: ['weight', 'kg'] },
    { key: 'date', label: '日期', editable: true, aliases: ['ymd'] },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_intake_targets: [
    { key: 'calories_kcal', label: '热量目标', editable: true },
    { key: 'protein_g', label: '蛋白目标', editable: true },
    { key: 'carbohydrate_g', label: '碳水目标', editable: true },
    { key: 'hydration_ml', label: '饮水目标', editable: true },
  ],
  commit_memo: [
    { key: 'title', label: '标题', editable: true, aliases: ['name'] },
    { key: 'body', label: '正文', editable: true, aliases: ['content', 'text'] },
  ],
  commit_recipe: [
    { key: 'title', label: '菜名', editable: true, aliases: ['name', 'recipe_name'], forceShow: true },
    {
      key: 'recipe_title',
      label: '菜谱',
      editable: false,
      aliases: ['recipe_name'],
    },
    {
      key: 'from_category_name',
      label: '原分类',
      editable: false,
      aliases: ['from_category'],
    },
    {
      key: 'recipe_count',
      label: '移动道数',
      editable: false,
      aliases: ['count'],
    },
    { key: 'servings', label: '份量', editable: true },
    {
      key: 'category_name',
      label: '目标分类',
      editable: true,
      aliases: ['category', 'category_hint'],
      forceShow: true,
      input: 'select',
    },
    {
      key: 'ingredients_text',
      label: '食材',
      editable: true,
      forceShow: true,
      aliases: ['ingredients'],
    },
    {
      key: 'steps_text',
      label: '步骤',
      editable: true,
      forceShow: true,
      aliases: ['steps'],
    },
    { key: 'notes', label: '备注', editable: true, aliases: ['note', 'description'] },
  ],
  commit_recipe_category: [
    {
      key: 'name',
      label: '分类名',
      editable: true,
      aliases: ['title', 'new_name'],
    },
    { key: 'old_name', label: '原名称', editable: false, aliases: ['category_name'] },
    { key: 'category_id', label: '分类ID', editable: false, aliases: ['id'] },
  ],
  commit_recipe_delete: [
    { key: 'recipe_title', label: '菜谱', editable: false, aliases: ['title', 'name'] },
    { key: 'recipe_id', label: '菜谱ID', editable: false, aliases: ['id'] },
  ],
  commit_recipe_category_delete: [
    { key: 'name', label: '分类名', editable: false, aliases: ['title', 'category_name'] },
    { key: 'category_id', label: '分类ID', editable: false, aliases: ['id'] },
    {
      key: 'recipe_count',
      label: '其下菜谱数',
      editable: false,
      aliases: ['count', 'child_count'],
    },
  ],
  commit_wardrobe_item: [
    { key: 'name', label: '单品', editable: true, aliases: ['title'] },
    { key: 'category', label: '分类', editable: true, aliases: ['category_name'] },
    { key: 'color', label: '颜色', editable: true },
    { key: 'brand', label: '品牌', editable: true },
    { key: 'season', label: '季节', editable: true },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_wardrobe_outfit: [
    { key: 'name', label: '搭配名', editable: true, aliases: ['title'] },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_wardrobe_wear: [
    { key: 'outfit_name', label: '搭配', editable: true, aliases: ['name', 'title'] },
    { key: 'date', label: '日期', editable: true, aliases: ['ymd'] },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_wardrobe_meta: [
    { key: 'name', label: '名称', editable: true, aliases: ['title'] },
    { key: 'kind', label: '类型', editable: true },
  ],
  commit_wardrobe_body: [
    { key: 'height_cm', label: '身高(cm)', editable: true },
    { key: 'weight_kg', label: '体重(kg)', editable: true },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_wish: [
    { key: 'title', label: '心愿', editable: true, aliases: ['name'] },
    { key: 'cost_points', label: '积分', editable: true, aliases: ['points', 'price'] },
    { key: 'wish_type', label: '类型', editable: true, aliases: ['type'] },
    { key: 'note', label: '备注', editable: true, aliases: ['body'] },
  ],
  commit_profile: [
    { key: 'display_name', label: '昵称', editable: true, aliases: ['name', 'nickname'] },
    { key: 'persona', label: '画像', editable: true, aliases: ['bio', 'profile_text'] },
  ],
  commit_life_road_node: [
    { key: 'title', label: '节点', editable: true, aliases: ['name'] },
    { key: 'status', label: '状态', editable: true },
    { key: 'note', label: '说明', editable: true, aliases: ['body', 'description'] },
  ],
  commit_life_direction: [
    { key: 'title', label: '方向', editable: true, aliases: ['name', 'direction'] },
    { key: 'note', label: '说明', editable: true, aliases: ['body'] },
  ],
  commit_life_bet: [
    { key: 'title', label: '赌注', editable: true, aliases: ['name'] },
    { key: 'stake', label: '筹码', editable: true, aliases: ['amount'] },
    { key: 'note', label: '说明', editable: true },
  ],
  commit_review_dimension: [
    { key: 'name', label: '维度', editable: true, aliases: ['title'] },
    { key: 'scope', label: '范围', editable: true },
  ],
  commit_review_journal: [
    { key: 'scope', label: '范围', editable: true },
    { key: 'date', label: '日期', editable: true, aliases: ['ymd'] },
    { key: 'body', label: '正文', editable: true, aliases: ['text', 'content'] },
  ],
  commit_review_column: [
    { key: 'column_key', label: '栏位', editable: true, aliases: ['key', 'column'] },
    { key: 'text', label: '内容', editable: true, aliases: ['body', 'content'] },
    { key: 'date', label: '日期', editable: true, aliases: ['ymd'] },
  ],
  commit_tag: [
    { key: 'tag_name', label: '标签', editable: true, aliases: ['name', 'title'] },
  ],
  commit_schedule_placement: [
    { key: 'title', label: '事项', editable: true, aliases: ['name'] },
    { key: 'date', label: '日期', editable: true, aliases: ['ymd'] },
    { key: 'start_time', label: '开始', editable: true, aliases: ['start'] },
    { key: 'end_time', label: '结束', editable: true, aliases: ['end'] },
  ],
};

/** 域级兜底（confirm_action 未知时） */
export const DOMAIN_FIELD_TEMPLATES: Record<string, DraftFieldSpec[]> = {
  finance: CONFIRM_CARD_FIELD_TEMPLATES.commit_finance_txn,
  task: CONFIRM_CARD_FIELD_TEMPLATES.commit_task,
  todo: CONFIRM_CARD_FIELD_TEMPLATES.commit_task,
  habit: CONFIRM_CARD_FIELD_TEMPLATES.commit_habit,
  food: CONFIRM_CARD_FIELD_TEMPLATES.commit_food_intake,
  health: CONFIRM_CARD_FIELD_TEMPLATES.commit_food_intake,
  memo: CONFIRM_CARD_FIELD_TEMPLATES.commit_memo,
  recipe: CONFIRM_CARD_FIELD_TEMPLATES.commit_recipe,
  wardrobe: CONFIRM_CARD_FIELD_TEMPLATES.commit_wardrobe_item,
  wish: CONFIRM_CARD_FIELD_TEMPLATES.commit_wish,
  profile: CONFIRM_CARD_FIELD_TEMPLATES.commit_profile,
  life_road: CONFIRM_CARD_FIELD_TEMPLATES.commit_life_road_node,
  review: CONFIRM_CARD_FIELD_TEMPLATES.commit_review_journal,
  project: CONFIRM_CARD_FIELD_TEMPLATES.commit_project,
  tag: CONFIRM_CARD_FIELD_TEMPLATES.commit_tag,
};

export function resolveFieldTemplate(
  confirmAction?: string | null,
  domain?: string | null,
): DraftFieldSpec[] | undefined {
  const action = (confirmAction || '').trim();
  if (action && CONFIRM_CARD_FIELD_TEMPLATES[action]) {
    return CONFIRM_CARD_FIELD_TEMPLATES[action];
  }
  const d = (domain || '').trim().toLowerCase();
  if (d && DOMAIN_FIELD_TEMPLATES[d]) {
    return DOMAIN_FIELD_TEMPLATES[d];
  }
  return undefined;
}

function formatIngredientsText(raw: unknown): string {
  if (!Array.isArray(raw)) return '';
  const lines: string[] = [];
  for (const row of raw.slice(0, 80)) {
    if (typeof row === 'string') {
      const name = row.trim();
      if (name) lines.push(name);
      continue;
    }
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const amount = typeof o.amount === 'string' ? o.amount.trim() : '';
    const remark = typeof o.remark === 'string' ? o.remark.trim() : '';
    if (!name && !amount && !remark) continue;
    if (remark) lines.push(`${name}｜${amount}｜${remark}`);
    else if (amount) lines.push(`${name}｜${amount}`);
    else lines.push(name);
  }
  return lines.join('\n');
}

function formatStepsText(raw: unknown): string {
  if (!Array.isArray(raw)) return '';
  return raw
    .map(s => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .slice(0, 80)
    .join('\n');
}

export function readDraftScalar(
  draft: Record<string, unknown>,
  key: string,
  aliases?: string[],
): { key: string; value: string } | null {
  const keys = [key, ...(aliases || [])];
  for (const k of keys) {
    if (!(k in draft)) continue;
    const v = draft[k];
    if (v == null || v === '') continue;
    if (Array.isArray(v)) {
      if (key === 'ingredients_text' || k === 'ingredients') {
        const text = formatIngredientsText(v);
        if (!text) continue;
        return { key, value: text };
      }
      if (key === 'steps_text' || k === 'steps') {
        const text = formatStepsText(v);
        if (!text) continue;
        return { key, value: text };
      }
      const parts = v
        .map(x => (typeof x === 'string' ? x.trim() : ''))
        .filter(Boolean);
      if (!parts.length) continue;
      return { key: k === key ? key : k, value: parts.join('、') };
    }
    if (typeof v === 'object') continue;
    return { key: k === key ? key : k, value: String(v) };
  }
  return null;
}

/** 多行编辑字段（ConfirmCard TextInput） */
export function isMultilineFieldKey(key: string): boolean {
  return /^(body|content|text|note|persona|description|bio|ingredients_text|steps_text|steps)$/i.test(
    key,
  );
}

/** 数字键盘字段 */
export function isNumericFieldKey(key: string): boolean {
  return /(amount|kcal|protein|carb|fat|hydration|weight|points|price|servings|balance|budget|deposit|target|rating|cm|ml|g$|_g$|_kg$|_ml$)/i.test(
    key,
  );
}

/** 需从现有列表点选的字段（菜谱分类等） */
export function isSelectFieldKey(
  key: string,
  confirmAction?: string | null,
): boolean {
  const action = (confirmAction || '').trim();
  if (action === 'commit_recipe' && /^(category_name|category|category_hint)$/i.test(key)) {
    return true;
  }
  return false;
}
