import { MaterialIcons } from '@expo/vector-icons';

export type FinanceSheetCategoryIconOption = {
  key: string;
  icon: keyof typeof MaterialIcons.glyphMap;
};

/** 记账弹层自定义分类可选图标（Material Icons） */
export const FINANCE_SHEET_CATEGORY_ICON_OPTIONS: FinanceSheetCategoryIconOption[] = [
  { key: 'restaurant', icon: 'restaurant' },
  { key: 'icecream', icon: 'icecream' },
  { key: 'eco', icon: 'eco' },
  { key: 'local-cafe', icon: 'local-cafe' },
  { key: 'set-meal', icon: 'set-meal' },
  { key: 'directions-car', icon: 'directions-car' },
  { key: 'home', icon: 'home' },
  { key: 'checkroom', icon: 'checkroom' },
  { key: 'sports-esports', icon: 'sports-esports' },
  { key: 'shopping-bag', icon: 'shopping-bag' },
  { key: 'pets', icon: 'pets' },
  { key: 'school', icon: 'school' },
  { key: 'local-hospital', icon: 'local-hospital' },
  { key: 'fitness-center', icon: 'fitness-center' },
  { key: 'movie', icon: 'movie' },
  { key: 'flight', icon: 'flight' },
  { key: 'payments', icon: 'payments' },
  { key: 'card-giftcard', icon: 'card-giftcard' },
  { key: 'receipt-long', icon: 'receipt-long' },
  { key: 'savings', icon: 'savings' },
  { key: 'storefront', icon: 'storefront' },
  { key: 'volunteer-activism', icon: 'volunteer-activism' },
  { key: 'redeem', icon: 'redeem' },
  { key: 'card-membership', icon: 'card-membership' },
  { key: 'home-work', icon: 'home-work' },
  { key: 'add-card', icon: 'add-card' },
  { key: 'bookmark', icon: 'bookmark' },
  { key: 'label', icon: 'label' },
  { key: 'category', icon: 'category' },
  { key: 'favorite', icon: 'favorite' },
];

export const DEFAULT_FINANCE_SHEET_CATEGORY_ICON: keyof typeof MaterialIcons.glyphMap = 'bookmark';
