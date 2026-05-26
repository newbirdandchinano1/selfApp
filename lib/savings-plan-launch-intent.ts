export type SavingsPlanLaunchIntent = {
  /** 进入存钱计划页后自动打开「添加计划」弹窗 */
  openAddPlan: boolean;
};

let pending: SavingsPlanLaunchIntent | null = null;

export function setSavingsPlanLaunchIntent(intent: SavingsPlanLaunchIntent) {
  pending = intent;
}

export function consumeSavingsPlanLaunchIntent(): SavingsPlanLaunchIntent | null {
  const next = pending;
  pending = null;
  return next;
}

/** 从存钱计划等入口跳转到财务存钱计划并打开添加弹窗 */
export function navigateToSavingsPlanAdd(router: { push: (href: '/savings-plan') => void }) {
  setSavingsPlanLaunchIntent({ openAddPlan: true });
  router.push('/savings-plan');
}
