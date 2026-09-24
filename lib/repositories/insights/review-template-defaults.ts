import type { ReviewTemplateScope } from './review-template.types';

/** 内置维度/栏目稳定 ID，便于从旧版固定字段迁移 */
export const REVIEW_TEMPLATE_DEFAULTS = {
  /** 极简日复盘：默认两问，降低冷启动；更多栏目可在模板设置中自行添加 */
  daily: [
    {
      id: 'rd_daily_what',
      title: '今天做了啥',
      sort_order: 10,
      columns: [
        {
          id: 'rc_daily_what',
          title: '今日记录',
          placeholder: '今天发生了什么？完成了哪些事？',
          sort_order: 10,
        },
      ],
    },
    {
      id: 'rd_daily_progress',
      title: '有啥进步',
      sort_order: 20,
      columns: [
        {
          id: 'rc_daily_progress',
          title: '今日进步',
          placeholder: '比昨天好一点的地方？学到了什么？',
          sort_order: 10,
        },
      ],
    },
  ],
  weekly: [
    {
      id: 'rd_weekly_summary',
      title: '汇总本周事件',
      sort_order: 10,
      columns: [
        {
          id: 'rc_weekly_summary',
          title: '本周回顾',
          placeholder:
            '这周发生了什么？完成了哪些计划？有什么收获与结果？遇到什么问题、进展如何？见了哪些重要的人、谈了什么？',
          sort_order: 10,
        },
      ],
    },
    {
      id: 'rd_weekly_plans',
      title: '计划完成情况',
      sort_order: 20,
      columns: [
        {
          id: 'rc_weekly_plans',
          title: '计划与交付',
          placeholder:
            '交付了什么成果？还有哪些任务没完成？这一周生活状态、家庭氛围如何？读了什么书、学到了什么？',
          sort_order: 10,
        },
      ],
    },
    {
      id: 'rd_weekly_reflect',
      title: '本周反思',
      sort_order: 30,
      columns: [
        {
          id: 'rc_weekly_reflect',
          title: '反思',
          placeholder: '已完成的任务有没有更好的做法？没完成的问题出在哪，打算怎么解决？',
          sort_order: 10,
        },
      ],
    },
    {
      id: 'rd_weekly_learnings',
      title: '复盘收获',
      sort_order: 40,
      columns: [
        { id: 'rc_weekly_learnings', title: '收获', placeholder: '发现了什么问题？总结出哪些经验？', sort_order: 10 },
      ],
    },
    {
      id: 'rd_weekly_next',
      title: '下周计划',
      sort_order: 50,
      columns: [
        {
          id: 'rc_weekly_next',
          title: '下周安排',
          placeholder: '下周如何安排时间、兼顾生活与工作？有哪些重点想推进？',
          sort_order: 10,
        },
      ],
    },
  ],
  monthly: [
    {
      id: 'rd_monthly_summary',
      title: '本月回顾',
      sort_order: 10,
      columns: [
        {
          id: 'rc_monthly_summary',
          title: '月度事件',
          placeholder: '这个月发生了什么？完成了哪些重要事项？有哪些值得记住的结果？',
          sort_order: 10,
        },
      ],
    },
    {
      id: 'rd_monthly_reflect',
      title: '本月反思',
      sort_order: 20,
      columns: [
        {
          id: 'rc_monthly_reflect',
          title: '反思与收获',
          placeholder: '哪些做法有效？卡在哪里？这个月学到了什么？',
          sort_order: 10,
        },
      ],
    },
    {
      id: 'rd_monthly_next',
      title: '下月计划',
      sort_order: 30,
      columns: [
        {
          id: 'rc_monthly_next',
          title: '下月安排',
          placeholder: '下个月最想推进的 1～3 件事是什么？如何安排节奏？',
          sort_order: 10,
        },
      ],
    },
  ],
} as const satisfies Record<
  ReviewTemplateScope,
  readonly {
    id: string;
    title: string;
    sort_order: number;
    columns: readonly { id: string; title: string; placeholder: string; sort_order: number }[];
  }[]
>;

/** 周复盘旧表字段 → 默认栏目 ID */
export const LEGACY_WEEKLY_COLUMN_IDS = {
  section_summary: 'rc_weekly_summary',
  section_plans: 'rc_weekly_plans',
  section_reflect: 'rc_weekly_reflect',
  section_learnings: 'rc_weekly_learnings',
  section_next_week: 'rc_weekly_next',
} as const;
