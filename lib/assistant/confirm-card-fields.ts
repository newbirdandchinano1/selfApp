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
  body_plain: '正文',
  content: '正文',
  tag_names: '标签',
  tags: '标签',
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
    {
      key: 'exclude_from_budget',
      label: '不计入预算',
      editable: true,
      aliases: ['include_in_budget'],
    },
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
    { key: 'enabled', label: '启用', editable: true },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_finance_cash_flow: [
    { key: 'name', label: '标题', editable: true, aliases: ['title', 'label'] },
    { key: 'amount', label: '金额', editable: true },
    { key: 'kind', label: '类型', editable: true, aliases: ['flow_kind', 'category'] },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_finance_budget: [
    { key: 'month_key', label: '预算月', editable: true, aliases: ['month'] },
    {
      key: 'base_amount',
      label: '预算基数',
      editable: true,
      aliases: ['suggested_base_amount', 'budget_amount', 'amount', 'total'],
    },
    {
      key: 'include_last_balance',
      label: '含上周期结余',
      editable: true,
      aliases: ['includeLastBalance'],
    },
    {
      key: 'period_surplus_override',
      label: '结余校正',
      editable: true,
      aliases: ['periodSurplusOverride'],
    },
    {
      key: 'refresh_day',
      label: '预算刷新日',
      editable: true,
      aliases: ['budget_refresh_day'],
    },
    { key: 'action', label: '动作', editable: true },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_finance_savings_goal: [
    {
      key: 'target_amount',
      label: '目标金额',
      editable: true,
      aliases: ['amount'],
    },
    {
      key: 'target_date',
      label: '目标日期',
      editable: true,
      aliases: ['date'],
    },
    { key: 'action', label: '动作', editable: true },
  ],
  commit_finance_account: [
    { key: 'name', label: '账户名', editable: true },
    { key: 'account_type', label: '类型', editable: true, aliases: ['type'] },
    { key: 'opening_balance', label: '初始余额', editable: true, aliases: ['balance'] },
    {
      key: 'exclude_from_total_assets',
      label: '不计入总资产',
      editable: true,
    },
    { key: 'hide_from_home', label: '首页隐藏', editable: true },
    { key: 'note', label: '备注', editable: true },
  ],
  commit_finance_account_delete: [
    { key: 'name', label: '账户名', editable: false },
  ],
  commit_finance_txn_delete: [
    { key: 'name', label: '流水', editable: false },
    { key: 'amount', label: '金额', editable: false },
  ],
  commit_finance_scheduled_delete: [
    { key: 'name', label: '定时支出', editable: false },
  ],
  commit_finance_flow_category: [
    { key: 'name', label: '分类名', editable: true },
    { key: 'kind', label: '流向', editable: true, aliases: ['flow_kind'] },
  ],
  commit_finance_flow_category_delete: [
    { key: 'name', label: '分类名', editable: false },
  ],
  commit_finance_account_type: [
    { key: 'name', label: '类型名', editable: true },
  ],
  commit_finance_account_type_delete: [
    { key: 'name', label: '类型名', editable: false },
  ],
  commit_finance_balance_correction: [
    {
      key: 'account_name',
      label: '账户',
      editable: true,
      aliases: ['name'],
    },
    {
      key: 'target_balance',
      label: '目标余额',
      editable: true,
      aliases: ['balance', 'targetLedgerBalance'],
    },
    { key: 'note', label: '备注', editable: true },
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
    { key: 'status', label: '状态', editable: true },
    { key: 'note', label: '备注', editable: true, aliases: ['body', 'content'] },
    { key: 'acceptance', label: '验收标准', editable: true },
  ],
  commit_project: [
    { key: 'title', label: '项目名', editable: true, aliases: ['name'] },
    { key: 'note', label: '说明', editable: true, aliases: ['body', 'description'] },
    { key: 'priority', label: '优先级', editable: true },
    { key: 'status', label: '状态', editable: true },
    { key: 'category_id', label: '分类', editable: true, aliases: ['category_name'] },
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
  commit_food_intake_delete: [
    {
      key: 'food_summary',
      label: '将删除',
      editable: false,
      aliases: ['title', 'food_name', 'name'],
    },
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
    { key: 'title', label: '标题', editable: true, aliases: ['name'], forceShow: true },
    {
      key: 'body_plain',
      label: '正文',
      editable: true,
      aliases: ['body', 'content', 'text'],
      forceShow: true,
    },
    {
      key: 'tag_names',
      label: '标签',
      editable: true,
      aliases: ['tags', 'tag_name', 'new_tag_names'],
      forceShow: true,
      /** 确认卡从现有 memo 标签多选，禁止自由输入新建 */
      input: 'select',
    },
  ],
  commit_memo_delete: [
    { key: 'title', label: '备忘', editable: false, aliases: ['name'] },
    { key: 'memo_id', label: '备忘ID', editable: false, aliases: ['id', 'memoId'] },
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
    {
      key: 'wish_type',
      label: '类型',
      editable: true,
      aliases: ['type'],
      forceShow: true,
      /** 确认卡从 once/repeat 点选，禁止自由输入 */
      input: 'select',
    },
    { key: 'note', label: '备注', editable: true, aliases: ['body'] },
  ],
  commit_wish_delete: [
    { key: 'title', label: '心愿', editable: false, aliases: ['name', 'wish_title'] },
    { key: 'cost_points', label: '积分', editable: false, aliases: ['points', 'price'] },
    { key: 'wish_id', label: '心愿ID', editable: false, aliases: ['id', 'wishId', 'item_id'] },
  ],
  commit_points_ledger_delete: [
    { key: 'title', label: '足迹', editable: false, aliases: ['reason', 'name'] },
    { key: 'delta', label: '变动', editable: false, aliases: ['points', 'cost_points'] },
    {
      key: 'ledger_id',
      label: '流水ID',
      editable: false,
      aliases: ['id', 'footprint_id'],
    },
  ],
  commit_profile: [
    { key: 'display_name', label: '昵称', editable: true, aliases: ['name', 'nickname'] },
    { key: 'persona', label: '画像', editable: true, aliases: ['bio', 'profile_text', 'persona_portrait'] },
    { key: 'gender', label: '性别', editable: true },
    { key: 'lifestyle', label: '生活习惯', editable: true },
    { key: 'goal', label: '目标', editable: true },
    { key: 'birthday', label: '生日', editable: true },
    { key: 'height', label: '身高(cm)', editable: true },
    { key: 'weight', label: '体重(kg)', editable: true },
    {
      key: 'workout_days',
      label: '健身日',
      editable: true,
      aliases: ['workoutDays', 'fitness_days', 'days'],
    },
    { key: 'tags', label: '饮食标签', editable: true },
    { key: 'allergies', label: '过敏', editable: true },
    { key: 'avoidFoods', label: '忌口', editable: true, aliases: ['avoid_foods'] },
    { key: 'notes', label: '饮食备注', editable: true },
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
    { key: 'date', label: '日期', editable: true, aliases: ['ymd', 'period_ymd'] },
    { key: 'body', label: '正文', editable: true, aliases: ['text', 'content'] },
    { key: 'column_title', label: '栏目', editable: true },
    { key: 'execution_score', label: '执行分', editable: true },
  ],
  commit_review_column: [
    { key: 'column_key', label: '栏位', editable: true, aliases: ['key', 'column', 'column_title', 'title'] },
    { key: 'text', label: '内容', editable: true, aliases: ['body', 'content', 'placeholder'] },
    { key: 'date', label: '日期', editable: true, aliases: ['ymd'] },
  ],
  commit_review_fill_empty: [
    { key: 'scope', label: '范围', editable: true },
    { key: 'date', label: '日期', editable: true, aliases: ['ymd', 'period_ymd'] },
    { key: 'replace', label: '覆盖非空', editable: true },
  ],
  commit_review_settings: [
    { key: 'weekly_review_weekday', label: '周复盘日', editable: true, aliases: ['weekday'] },
    { key: 'daily_reminder_enabled', label: '日提醒', editable: true },
    { key: 'daily_reminder_hour', label: '日提醒时', editable: true },
    { key: 'weekly_reminder_enabled', label: '周提醒', editable: true },
    { key: 'points_enabled', label: '积分开关', editable: true },
    { key: 'daily_reward_points', label: '日奖励', editable: true },
    { key: 'streak7_bonus_points', label: '七天奖励', editable: true },
  ],
  commit_review_dimension_delete: [
    { key: 'dimension_title', label: '维度', editable: false, aliases: ['title', 'name'] },
    { key: 'dimension_id', label: '维度ID', editable: false, aliases: ['id'] },
  ],
  commit_review_column_delete: [
    { key: 'column_title', label: '栏目', editable: false, aliases: ['title', 'name'] },
    { key: 'column_id', label: '栏目ID', editable: false, aliases: ['id'] },
  ],
  commit_tag: [
    { key: 'name', label: '新名称', editable: true, aliases: ['title'] },
    { key: 'old_name', label: '原名称', editable: false, aliases: ['tag_name'] },
    { key: 'color', label: '颜色', editable: true },
    { key: 'weight', label: '权重', editable: true },
    { key: 'note', label: '简介', editable: true, aliases: ['description'] },
    { key: 'tag_id', label: '标签ID', editable: false },
  ],
  commit_tag_delete: [
    { key: 'name', label: '标签', editable: false, aliases: ['tag_name', 'title', 'old_name'] },
    { key: 'tag_id', label: '标签ID', editable: false, aliases: ['id'] },
    {
      key: 'link_count',
      label: '关联备忘数',
      editable: false,
      aliases: ['count', 'memo_count'],
    },
  ],
  commit_schedule_placement: [
    { key: 'title', label: '事项', editable: true, aliases: ['name'] },
    { key: 'date', label: '日期', editable: true, aliases: ['ymd'] },
    { key: 'start_time', label: '开始', editable: true, aliases: ['start'] },
    { key: 'end_time', label: '结束', editable: true, aliases: ['end'] },
  ],
  commit_promote_todo_to_project: [
    { key: 'task_title', label: '待办', editable: false, aliases: ['title', 'name'] },
    { key: 'task_id', label: '待办ID', editable: false, aliases: ['id'] },
    { key: 'project_name', label: '项目名', editable: true, aliases: ['name'] },
  ],
  commit_day_boundary: [
    { key: 'hour', label: '时', editable: true, aliases: ['day_boundary_hour'] },
    { key: 'minute', label: '分', editable: true, aliases: ['day_boundary_minute'] },
    { key: 'pages', label: '生效页面', editable: true },
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
  return /^(body|body_plain|content|text|note|persona|description|bio|ingredients_text|steps_text|steps)$/i.test(
    key,
  );
}

/** 数字键盘字段 */
export function isNumericFieldKey(key: string): boolean {
  return /(amount|kcal|protein|carb|fat|hydration|weight|points|price|servings|balance|budget|deposit|target|rating|cm|ml|g$|_g$|_kg$|_ml$)/i.test(
    key,
  );
}

/** 备忘确认卡：标签须从现有 memo 域标签多选 */
export function isMemoTagSelectFieldKey(
  key: string,
  confirmAction?: string | null,
): boolean {
  const action = (confirmAction || '').trim();
  return (
    action === 'commit_memo' && /^(tag_names|tags|tag_name|new_tag_names)$/i.test(key)
  );
}

/** 心愿确认卡：类型仅 once / repeat 二选一 */
export const WISH_TYPE_SELECT_OPTIONS = [
  { id: 'once', name: '一次性', hint: '兑换后即结束' },
  { id: 'repeat', name: '可重复', hint: '可多次兑换' },
] as const;

export function isWishTypeSelectFieldKey(
  key: string,
  confirmAction?: string | null,
): boolean {
  const action = (confirmAction || '').trim();
  return action === 'commit_wish' && /^(wish_type|type)$/i.test(key);
}

/** 展示用：once/repeat → 中文；已是中文则原样 */
export function formatWishTypeLabel(raw: unknown): string {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!s) return '';
  if (s === 'repeat' || s === '重复' || s === '可重复' || s === 'repeated') return '可重复';
  if (s === 'once' || s === '一次性' || s === '单次') return '一次性';
  return String(raw ?? '').trim();
}

/** 需从现有列表点选的字段（菜谱分类 / 备忘标签 / 心愿类型等） */
export function isSelectFieldKey(
  key: string,
  confirmAction?: string | null,
): boolean {
  const action = (confirmAction || '').trim();
  if (action === 'commit_recipe' && /^(category_name|category|category_hint)$/i.test(key)) {
    return true;
  }
  if (isMemoTagSelectFieldKey(key, confirmAction)) {
    return true;
  }
  if (isWishTypeSelectFieldKey(key, confirmAction)) {
    return true;
  }
  return false;
}
