import { MaterialIcons } from '@expo/vector-icons';

export type FinanceAccountIconOption = {
  key: string;
  icon: keyof typeof MaterialIcons.glyphMap;
};

export const FINANCE_ACCOUNT_ICON_OPTIONS: FinanceAccountIconOption[] = [
  { key: 'home', icon: 'home' },
  { key: 'car', icon: 'directions-car' },
  { key: 'savings', icon: 'savings' },
  { key: 'bag', icon: 'shopping-bag' },
  { key: 'restaurant', icon: 'restaurant' },
  { key: 'flight', icon: 'flight' },
  { key: 'fitness', icon: 'fitness-center' },
  { key: 'pets', icon: 'pets' },
  { key: 'school', icon: 'school' },
  { key: 'store', icon: 'local-grocery-store' },
  { key: 'bus', icon: 'directions-bus' },
  { key: 'train', icon: 'train' },
  { key: 'hospital', icon: 'local-hospital' },
  { key: 'pharmacy', icon: 'local-pharmacy' },
  { key: 'work', icon: 'work' },
  { key: 'gift', icon: 'card-giftcard' },
  { key: 'music', icon: 'music-note' },
  { key: 'movie', icon: 'movie' },
  { key: 'hotel', icon: 'hotel' },
  { key: 'beach', icon: 'beach-access' },
  { key: 'phone', icon: 'phone-iphone' },
  { key: 'wifi', icon: 'wifi' },
  { key: 'tools', icon: 'build' },
  { key: 'games', icon: 'sports-esports' },
  { key: 'spa', icon: 'spa' },
];

