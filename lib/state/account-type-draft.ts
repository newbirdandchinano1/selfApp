type CustomAccountTypeDraft = {
  name: string;
  isLiability: boolean;
  iconKey: string;
};

export type CustomAccountTypeOption = {
  name: string;
  isLiability: boolean;
  iconKey: string;
};

let customAccountTypeDraft: CustomAccountTypeDraft = {
  name: '',
  isLiability: false,
  iconKey: 'savings',
};

let customAccountTypeOptions: CustomAccountTypeOption[] = [];

export function getCustomAccountTypeDraft(): CustomAccountTypeDraft {
  return customAccountTypeDraft;
}

export function setCustomAccountTypeDraft(next: CustomAccountTypeDraft) {
  customAccountTypeDraft = next;
}

export function getCustomAccountTypeOptions(): CustomAccountTypeOption[] {
  return customAccountTypeOptions;
}

export function upsertCustomAccountTypeOption(next: CustomAccountTypeOption) {
  const normalized = next.name.trim();
  if (!normalized) return;
  const idx = customAccountTypeOptions.findIndex((item) => item.name === normalized);
  const value: CustomAccountTypeOption = {
    name: normalized,
    isLiability: next.isLiability,
    iconKey: next.iconKey || 'savings',
  };
  if (idx >= 0) {
    customAccountTypeOptions = [
      ...customAccountTypeOptions.slice(0, idx),
      value,
      ...customAccountTypeOptions.slice(idx + 1),
    ];
    return;
  }
  customAccountTypeOptions = [...customAccountTypeOptions, value];
}

export function removeCustomAccountTypeOption(name: string) {
  const normalized = name.trim();
  if (!normalized) return;
  customAccountTypeOptions = customAccountTypeOptions.filter((item) => item.name !== normalized);
}

