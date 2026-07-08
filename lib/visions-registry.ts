/**
 * 愿景墙 / 我的页轮播 / 详情页共用的静态数据（后续可替换为存储层）。
 */

export type VisionKind = 'progress' | 'count' | 'target' | 'countdown';

/** 愿景墙「目标」卡片上的小目标摘要 */
export type VisionWallSubGoalItem = {
  id: string;
  name: string;
  boundProjectCount: number;
  taskProgress: { completed: number; total: number } | null;
  /** 未绑定项目且已手动完成 */
  standaloneDone?: boolean;
};

/** 卡片/详情背景：内置 require 或相册 URI */
export type VisionCardImageSource = number | { uri: string };

export type VisionWallCardModel =
  | {
      kind: 'progress';
      title: string;
      /** 总目标描述（墙卡标题下展示） */
      description?: string;
      percentText: string;
      percent: number;
      leftKicker: string;
      leftValue: string;
      rightKicker: string;
      rightValue: string;
      imageSource: VisionCardImageSource;
      /** 愿景墙：可编辑的当前完成值（仅本地 DB 卡片填充） */
      wallAdjust?: { current: number; unit?: string };
    }
  | {
      kind: 'count';
      title: string;
      /** 总目标描述（墙卡标题下展示） */
      description?: string;
      leftKicker: string;
      leftValue: string;
      rightKicker: string;
      rightValue: string;
      imageSource: VisionCardImageSource;
      /** 愿景墙 +/-：当前累计与单次步长（仅本地 DB 卡片填充） */
      wallAdjust?: { current: number; step: number };
    }
  | {
      kind: 'target';
      title: string;
      /** 总目标描述（墙卡标题下展示） */
      description?: string;
      percentText: string;
      percent: number;
      imageSource: VisionCardImageSource;
      /** 来自关联项目任务时不展示手动加减 */
      taskProgressOnly?: boolean;
      /** 绑定的小目标（墙卡底部展示，替代步长按钮） */
      subGoals?: VisionWallSubGoalItem[];
      /** 无小目标且无关联任务进度：墙卡仅展示完成勾选 */
      simpleComplete?: boolean;
      isComplete?: boolean;
    }
  | {
      kind: 'countdown';
      title: string;
      /** 总目标描述（墙卡标题下展示） */
      description?: string;
      dateText: string;
      remainText: string;
      /** 正数日：左侧为记录日期，右侧为「已过去 N 天」 */
      countdownKind?: 'countdown' | 'countup';
      imageSource: VisionCardImageSource;
    };

/** 愿景墙展示字段（图片沿用愿景主体的 imageSource） */
export type VisionWallFields =
  | {
      kind: 'progress';
      title: string;
      percentText: string;
      percent: number;
      leftKicker: string;
      leftValue: string;
      rightKicker: string;
      rightValue: string;
    }
  | {
      kind: 'count';
      title: string;
      leftKicker: string;
      leftValue: string;
      rightKicker: string;
      rightValue: string;
    }
  | {
      kind: 'target';
      title: string;
      percentText: string;
      percent: number;
    }
  | {
      kind: 'countdown';
      title: string;
      dateText: string;
      remainText: string;
      countdownKind?: 'countdown' | 'countup';
    };

export type VisionMilestone = { label: string; done: boolean };

export type VisionRecord = {
  id: string;
  kind: VisionKind;
  title: string;
  imageSource: VisionCardImageSource;
  /** 「我的」轮播卡片 */
  profile?: {
    kicker: string;
    year: string;
    progressPercent: number;
    progressText: string;
  };
  /** 详情页副标题 / 分类 */
  detailKicker: string;
  description: string;
  milestones?: VisionMilestone[];
  /** 愿景墙列表展示（仅出现在墙上的条目需要完整字段） */
  wall?: VisionWallFields;
};

const card1 = require('../assets/vision-wall/card1.png');
const card2 = require('../assets/vision-wall/card2.png');
const card3 = require('../assets/vision-wall/card3.png');
const card4 = require('../assets/vision-wall/card4.png');
const bg2 = require('../assets/vision-bg/bg2.png');
const bg3 = require('../assets/vision-bg/bg3.png');

const visions: VisionRecord[] = [
  {
    id: 'tibet-ride',
    kind: 'progress',
    title: '西藏骑行之旅',
    imageSource: card1,
    detailKicker: '远征挑战',
    description:
      '用链条丈量海拔与风速，把漫长的爬坡分解成每一天的可执行里程。当前节奏稳定，补给与休整安排合理，适宜在下一阶段逐步提高周里程。',
    milestones: [
      { label: '完成高原适应性训练周', done: true },
      { label: '分段骑行累计 ≥800km', done: false },
      { label: '抵达拉萨并完成复盘', done: false },
    ],
    wall: {
      kind: 'progress',
      title: '西藏骑行之旅',
      percentText: '65%',
      percent: 0.65,
      leftKicker: '本周进度',
      leftValue: '本周 85 km',
      rightKicker: '当前总量',
      rightValue: '650 / 1000 km',
    },
  },
  {
    id: 'books-read',
    kind: 'count',
    title: '完成 50 本书的阅读',
    imageSource: card2,
    profile: {
      kicker: '年度目标',
      year: '2024',
      progressPercent: 24,
      progressText: '已读 12 / 50 (24%)',
    },
    detailKicker: '认知复利',
    description:
      '阅读不是为了数量，而是建立跨学科的索引。保持每周至少两次深度阅读，配合简短笔记，把灵感接入行动清单。',
    milestones: [
      { label: '建立主题书架（技术 / 人文 / 商业）', done: true },
      { label: '输出 6 篇读书笔记', done: false },
      { label: '完成 50 本并回顾 Top 10', done: false },
    ],
    wall: {
      kind: 'count',
      title: '完成 50 本书的阅读',
      leftKicker: '本周进度',
      leftValue: '本周: 2 次',
      rightKicker: '当前总量',
      rightValue: '已读 12 / 50',
    },
  },
  {
    id: 'savings-goal',
    kind: 'target',
    title: '储蓄目标',
    imageSource: card3,
    detailKicker: '财务纪律',
    description:
      '把「存下来」设计成自动流程：固定比例入账、消费分层、每月复盘现金流。目标进度可通过关联记账与愿望清单联动更新。',
    milestones: [
      { label: '设定自动转账规则', done: true },
      { label: '连续 3 个月达成储蓄比例', done: false },
      { label: '年度目标金额 100%', done: false },
    ],
    wall: {
      kind: 'target',
      title: '储蓄目标',
      percentText: '60%',
      percent: 0.6,
    },
  },
  {
    id: 'language-learn',
    kind: 'countdown',
    title: '学会一门新语言',
    imageSource: card4,
    detailKicker: '每日输入',
    description:
      '语言学习的关键是稳定的输入与输出循环：每日精听、跟读与造句。倒数日用于锁定考试或阶段性演示日期，保持紧迫感。',
    milestones: [
      { label: '完成语音基础与拼读', done: true },
      { label: '累计 100 小时刻意练习', done: false },
      { label: '通过阶段性测评', done: false },
    ],
    wall: {
      kind: 'countdown',
      title: '学会一门新语言',
      dateText: '2024-12-31',
      remainText: '还有 45 天',
      countdownKind: 'countdown',
    },
  },
  {
    id: 'run-km',
    kind: 'progress',
    title: '累计跑步 600 公里',
    imageSource: bg2,
    profile: {
      kicker: '健康挑战',
      year: '2024',
      progressPercent: 33,
      progressText: '已跑 198 / 600 (33%)',
    },
    detailKicker: '耐力构建',
    description:
      '跑步愿景强调可持续：控制周跑量爬升、重视热身放松与睡眠。把速度训练留给周期末段，基础期以有氧与力量辅助为主。',
    milestones: [
      { label: '连续跑步 8 周无伤', done: true },
      { label: '单次 LSD ≥25km', done: false },
      { label: '年度跑量达标 600km', done: false },
    ],
    wall: {
      kind: 'progress',
      title: '累计跑步 600 公里',
      percentText: '33%',
      percent: 0.33,
      leftKicker: '本周进度',
      leftValue: '本周 12 km',
      rightKicker: '当前总量',
      rightValue: '198 / 600 km',
    },
  },
  {
    id: 'cities-travel',
    kind: 'progress',
    title: '打卡 12 座城市',
    imageSource: bg3,
    profile: {
      kicker: '人生体验',
      year: '2024',
      progressPercent: 34,
      progressText: '已完成 4 / 12 (34%)',
    },
    detailKicker: '在路上',
    description:
      '城市打卡不等于集邮：每次出行记录一家小店、一条步道或一场展览，把体验沉淀为可重温的故事与影像。',
    milestones: [
      { label: '整理旅行胶囊相册', done: false },
      { label: '完成 12 城足迹地图', done: false },
      { label: '输出一篇长线游记', done: false },
    ],
    wall: {
      kind: 'progress',
      title: '打卡 12 座城市',
      percentText: '33%',
      percent: 0.33,
      leftKicker: '本周进度',
      leftValue: '本周 1 座',
      rightKicker: '当前总量',
      rightValue: '已点亮 4 / 12',
    },
  },
];

const byId: Record<string, VisionRecord> = Object.fromEntries(visions.map(v => [v.id, v]));

export function getVisionById(id: string): VisionRecord | undefined {
  return byId[id];
}

/** 「我的」页愿景轮播顺序 */
export const PROFILE_VISION_IDS = ['books-read', 'run-km', 'cities-travel'] as const;

/** 愿景墙列表顺序 */
export const VISION_WALL_IDS = ['tibet-ride', 'books-read', 'savings-goal', 'language-learn'] as const;

export type ProfileVisionCarouselItem = {
  id: string;
  kicker: string;
  title: string;
  progressText: string;
  progress: number;
  year: string;
  imageSource: VisionCardImageSource;
};

export function getProfileVisionCarouselItems(): ProfileVisionCarouselItem[] {
  return PROFILE_VISION_IDS.map(id => {
    const v = byId[id];
    const p = v?.profile;
    if (!v || !p) {
      throw new Error(`Missing profile vision: ${id}`);
    }
    return {
      id: v.id,
      kicker: p.kicker,
      title: v.title,
      progressText: p.progressText,
      progress: p.progressPercent,
      year: p.year,
      imageSource: v.imageSource,
    };
  });
}

export function getVisionWallCards(): VisionWallCardModel[] {
  return VISION_WALL_IDS.map(id => {
    const v = byId[id];
    if (!v?.wall) throw new Error(`Missing wall vision: ${id}`);
    const description = v.description?.trim();
    return {
      ...v.wall,
      imageSource: v.imageSource,
      ...(description ? { description } : {}),
    } as VisionWallCardModel;
  });
}
