/** 菜谱分类插图图标：食物相关 Unicode emoji（系统彩色插画渲染） */

export type RecipeCategoryIconGroup =
  | 'fruit'
  | 'veg'
  | 'staple'
  | 'meat'
  | 'seafood'
  | 'asian'
  | 'prepared'
  | 'sweet'
  | 'drink'
  | 'dishware';

export type RecipeCategoryIconOption = {
  key: string;
  emoji: string;
  label: string;
  group: RecipeCategoryIconGroup;
  soft: string;
};

export const RECIPE_CATEGORY_ICON_GROUP_LABELS: Record<RecipeCategoryIconGroup, string> = {
  fruit: '水果',
  veg: '蔬菜菌菇',
  staple: '面包主食',
  meat: '肉蛋奶',
  seafood: '海鲜',
  asian: '中式日料',
  prepared: '快餐熟食',
  sweet: '甜品烘焙',
  drink: '饮品',
  dishware: '餐具调味',
};

const SOFT: Record<RecipeCategoryIconGroup, string> = {
  fruit: 'rgba(236,72,153,0.1)',
  veg: 'rgba(34,197,94,0.12)',
  staple: 'rgba(202,138,4,0.12)',
  meat: 'rgba(239,68,68,0.1)',
  seafood: 'rgba(14,165,233,0.12)',
  asian: 'rgba(249,115,22,0.12)',
  prepared: 'rgba(234,88,12,0.1)',
  sweet: 'rgba(244,114,182,0.12)',
  drink: 'rgba(139,92,246,0.1)',
  dishware: 'rgba(100,116,139,0.12)',
};

function opt(
  key: string,
  emoji: string,
  label: string,
  group: RecipeCategoryIconGroup,
): RecipeCategoryIconOption {
  return { key, emoji, label, group, soft: SOFT[group] };
}

/**
 * ~170 个食物相关插图图标（Food & Drink 全量 + 常见可食用动物/厨具补齐）。
 * key 稳定；旧 Material 风格 key 见 LEGACY_ICON_KEY_ALIASES。
 */
export const RECIPE_CATEGORY_ICON_OPTIONS: RecipeCategoryIconOption[] = [
  // —— 水果 ——
  opt('grapes', '🍇', '葡萄', 'fruit'),
  opt('melon', '🍈', '甜瓜', 'fruit'),
  opt('watermelon', '🍉', '西瓜', 'fruit'),
  opt('tangerine', '🍊', '橘子', 'fruit'),
  opt('lemon', '🍋', '柠檬', 'fruit'),
  opt('lime', '🍋‍🟩', '青柠', 'fruit'),
  opt('banana', '🍌', '香蕉', 'fruit'),
  opt('pineapple', '🍍', '菠萝', 'fruit'),
  opt('mango', '🥭', '芒果', 'fruit'),
  opt('red_apple', '🍎', '红苹果', 'fruit'),
  opt('green_apple', '🍏', '青苹果', 'fruit'),
  opt('pear', '🍐', '梨', 'fruit'),
  opt('peach', '🍑', '桃', 'fruit'),
  opt('cherries', '🍒', '樱桃', 'fruit'),
  opt('strawberry', '🍓', '草莓', 'fruit'),
  opt('blueberries', '🫐', '蓝莓', 'fruit'),
  opt('kiwi', '🥝', '猕猴桃', 'fruit'),
  opt('tomato', '🍅', '番茄', 'fruit'),
  opt('olive', '🫒', '橄榄', 'fruit'),
  opt('coconut', '🥥', '椰子', 'fruit'),

  // —— 蔬菜菌菇 ——
  opt('avocado', '🥑', '牛油果', 'veg'),
  opt('eggplant', '🍆', '茄子', 'veg'),
  opt('potato', '🥔', '土豆', 'veg'),
  opt('carrot', '🥕', '胡萝卜', 'veg'),
  opt('corn', '🌽', '玉米', 'veg'),
  opt('hot_pepper', '🌶️', '辣椒', 'veg'),
  opt('bell_pepper', '🫑', '甜椒', 'veg'),
  opt('cucumber', '🥒', '黄瓜', 'veg'),
  opt('leafy_green', '🥬', '绿叶菜', 'veg'),
  opt('broccoli', '🥦', '西兰花', 'veg'),
  opt('garlic', '🧄', '大蒜', 'veg'),
  opt('onion', '🧅', '洋葱', 'veg'),
  opt('mushroom', '🍄', '蘑菇', 'veg'),
  opt('peanuts', '🥜', '花生', 'veg'),
  opt('beans', '🫘', '豆子', 'veg'),
  opt('chestnut', '🌰', '栗子', 'veg'),
  opt('ginger', '🫚', '生姜', 'veg'),
  opt('pea_pod', '🫛', '豌豆荚', 'veg'),
  opt('brown_mushroom', '🍄‍🟫', '菌菇', 'veg'),
  opt('root_vegetable', '🫜', '根菜', 'veg'),
  opt('herb', '🌿', '香草', 'veg'),
  opt('seedling', '🌱', '芽菜', 'veg'),
  opt('four_leaf', '🍀', '香菜', 'veg'),

  // —— 面包主食 ——
  opt('bread', '🍞', '面包', 'staple'),
  opt('croissant', '🥐', '可颂', 'staple'),
  opt('baguette', '🥖', '法棍', 'staple'),
  opt('flatbread', '🫓', '饼', 'staple'),
  opt('pretzel', '🥨', '椒盐卷', 'staple'),
  opt('bagel', '🥯', '贝果', 'staple'),
  opt('pancakes', '🥞', '松饼', 'staple'),
  opt('waffle', '🧇', '华夫饼', 'staple'),
  opt('cooked_rice', '🍚', '米饭', 'staple'),
  opt('rice_ball', '🍙', '饭团', 'staple'),
  opt('rice_cracker', '🍘', '米饼', 'staple'),
  opt('curry_rice', '🍛', '咖喱饭', 'staple'),
  opt('spaghetti', '🍝', '意面', 'staple'),
  opt('steaming_bowl', '🍜', '汤面', 'staple'),
  opt('sweet_potato', '🍠', '烤红薯', 'staple'),
  opt('chestnut_roast', '🌰', '板栗', 'staple'),

  // —— 肉蛋奶 ——
  opt('cheese', '🧀', '奶酪', 'meat'),
  opt('meat_on_bone', '🍖', '带骨肉', 'meat'),
  opt('poultry_leg', '🍗', '鸡腿', 'meat'),
  opt('cut_of_meat', '🥩', '牛排', 'meat'),
  opt('bacon', '🥓', '培根', 'meat'),
  opt('egg', '🥚', '鸡蛋', 'meat'),
  opt('cooking', '🍳', '煎蛋', 'meat'),
  opt('butter', '🧈', '黄油', 'meat'),
  opt('glass_of_milk', '🥛', '牛奶', 'meat'),
  opt('baby_bottle', '🍼', '奶瓶', 'meat'),
  opt('cow', '🐄', '牛肉', 'meat'),
  opt('pig', '🐖', '猪肉', 'meat'),
  opt('chicken', '🐔', '鸡肉', 'meat'),
  opt('turkey', '🦃', '火鸡', 'meat'),
  opt('duck', '🦆', '鸭肉', 'meat'),
  opt('sheep', '🐑', '羊肉', 'meat'),

  // —— 海鲜 ——
  opt('fish', '🐟', '鱼', 'seafood'),
  opt('tropical_fish', '🐠', '热带鱼', 'seafood'),
  opt('blowfish', '🐡', '河豚', 'seafood'),
  opt('shark', '🦈', '鲨鱼', 'seafood'),
  opt('octopus', '🐙', '章鱼', 'seafood'),
  opt('squid', '🦑', '鱿鱼', 'seafood'),
  opt('shrimp', '🦐', '虾', 'seafood'),
  opt('fried_shrimp', '🍤', '炸虾', 'seafood'),
  opt('crab', '🦀', '蟹', 'seafood'),
  opt('lobster', '🦞', '龙虾', 'seafood'),
  opt('oyster', '🦪', '牡蛎', 'seafood'),
  opt('fish_cake', '🍥', '鱼板', 'seafood'),
  opt('sushi', '🍣', '寿司', 'seafood'),
  opt('oden', '🍢', '关东煮', 'seafood'),

  // —— 中式日料 ——
  opt('bento', '🍱', '便当', 'asian'),
  opt('dumpling', '🥟', '饺子', 'asian'),
  opt('fortune_cookie', '🥠', '幸运饼', 'asian'),
  opt('takeout_box', '🥡', '外卖盒', 'asian'),
  opt('moon_cake', '🥮', '月饼', 'asian'),
  opt('dango', '🍡', '团子', 'asian'),
  opt('steaming_bowl_asian', '🍜', '拉面', 'asian'),
  opt('rice_bowl_asian', '🍚', '白饭', 'asian'),
  opt('teapot_asian', '🫖', '茶壶', 'asian'),
  opt('sake', '🍶', '清酒', 'asian'),
  opt('chopsticks', '🥢', '筷子', 'asian'),
  opt('leafy_hotpot', '🥬', '火锅菜', 'asian'),
  opt('pot_asian', '🍲', '砂锅', 'asian'),
  opt('shallow_pan_asian', '🥘', '干锅', 'asian'),
  opt('bowl_spoon_asian', '🥣', '粥', 'asian'),
  opt('canned_food', '🥫', '罐头', 'asian'),

  // —— 快餐熟食 ——
  opt('hamburger', '🍔', '汉堡', 'prepared'),
  opt('french_fries', '🍟', '薯条', 'prepared'),
  opt('pizza', '🍕', '披萨', 'prepared'),
  opt('hot_dog', '🌭', '热狗', 'prepared'),
  opt('sandwich', '🥪', '三明治', 'prepared'),
  opt('taco', '🌮', '塔可', 'prepared'),
  opt('burrito', '🌯', '卷饼', 'prepared'),
  opt('tamale', '🫔', '玉米粉蒸肉', 'prepared'),
  opt('stuffed_flatbread', '🥙', '夹饼', 'prepared'),
  opt('falafel', '🧆', '法拉费', 'prepared'),
  opt('shallow_pan', '🥘', '平底锅菜', 'prepared'),
  opt('pot_of_food', '🍲', '炖菜', 'prepared'),
  opt('fondue', '🫕', '火锅芝士', 'prepared'),
  opt('bowl_with_spoon', '🥣', '碗装', 'prepared'),
  opt('green_salad', '🥗', '沙拉', 'prepared'),
  opt('popcorn', '🍿', '爆米花', 'prepared'),
  opt('pretzel_snack', '🥨', '小食', 'prepared'),
  opt('chestnut_snack', '🌰', '坚果', 'prepared'),

  // —— 甜品烘焙 ——
  opt('soft_ice_cream', '🍦', '软冰淇淋', 'sweet'),
  opt('shaved_ice', '🍧', '刨冰', 'sweet'),
  opt('ice_cream', '🍨', '冰淇淋', 'sweet'),
  opt('doughnut', '🍩', '甜甜圈', 'sweet'),
  opt('cookie', '🍪', '曲奇', 'sweet'),
  opt('birthday_cake', '🎂', '生日蛋糕', 'sweet'),
  opt('shortcake', '🍰', '蛋糕', 'sweet'),
  opt('cupcake', '🧁', '纸杯蛋糕', 'sweet'),
  opt('pie', '🥧', '派', 'sweet'),
  opt('chocolate_bar', '🍫', '巧克力', 'sweet'),
  opt('candy', '🍬', '糖果', 'sweet'),
  opt('lollipop', '🍭', '棒棒糖', 'sweet'),
  opt('custard', '🍮', '布丁', 'sweet'),
  opt('honey_pot', '🍯', '蜂蜜', 'sweet'),
  opt('croissant_sweet', '🥐', '酥点', 'sweet'),
  opt('cookie_bake', '🍪', '烘焙', 'sweet'),
  opt('moon_cake_sweet', '🥮', '糕点', 'sweet'),
  opt('dango_sweet', '🍡', '糖葫芦', 'sweet'),

  // —— 饮品 ——
  opt('hot_beverage', '☕', '咖啡', 'drink'),
  opt('teapot', '🫖', '茶', 'drink'),
  opt('teacup', '🍵', '茶杯', 'drink'),
  opt('bubble_tea', '🧋', '奶茶', 'drink'),
  opt('cup_with_straw', '🥤', '饮料', 'drink'),
  opt('beverage_box', '🧃', '果汁盒', 'drink'),
  opt('mate', '🧉', '马黛茶', 'drink'),
  opt('pouring_liquid', '🫗', '倒水', 'drink'),
  opt('wine_glass', '🍷', '红酒', 'drink'),
  opt('cocktail', '🍸', '鸡尾酒', 'drink'),
  opt('tropical_drink', '🍹', '热带饮', 'drink'),
  opt('beer_mug', '🍺', '啤酒', 'drink'),
  opt('clinking_beers', '🍻', '干杯', 'drink'),
  opt('clinking_glasses', '🥂', '香槟', 'drink'),
  opt('tumbler_glass', '🥃', '威士忌', 'drink'),
  opt('bottle_cork', '🍾', '香槟瓶', 'drink'),
  opt('ice', '🧊', '冰块', 'drink'),
  opt('sake_drink', '🍶', '清酒杯', 'drink'),

  // —— 餐具调味 ——
  opt('salt', '🧂', '盐', 'dishware'),
  opt('honey_seasoning', '🍯', '调味蜜', 'dishware'),
  opt('butter_seasoning', '🧈', '黄油块', 'dishware'),
  opt('jar', '🫙', '罐子', 'dishware'),
  opt('amphora', '🏺', '陶罐', 'dishware'),
  opt('fork_and_knife', '🍴', '刀叉', 'dishware'),
  opt('fork_knife_plate', '🍽️', '餐盘', 'dishware'),
  opt('spoon', '🥄', '勺子', 'dishware'),
  opt('kitchen_knife', '🔪', '菜刀', 'dishware'),
  opt('chopsticks_ware', '🥢', '筷架', 'dishware'),
  opt('fire', '🔥', '明火', 'dishware'),
  opt('droplet', '💧', '水', 'dishware'),
  opt('basket', '🧺', '菜篮', 'dishware'),
  opt('shopping_cart', '🛒', '采购', 'dishware'),
  opt('package', '📦', '食材包', 'dishware'),
];

/** 旧 Material 图标 key → 新 emoji key（兼容已保存的 meta） */
export const LEGACY_ICON_KEY_ALIASES: Record<string, string> = {
  soup: 'steaming_bowl',
  stew: 'pot_of_food',
  home: 'cooking',
  seafood: 'fried_shrimp',
  veg: 'leafy_green',
  staple: 'cooked_rice',
  snack: 'french_fries',
  drink: 'bubble_tea',
  bakery: 'croissant',
  seasoning: 'salt',
  ramen: 'steaming_bowl',
  kebab: 'meat_on_bone',
  icecream: 'soft_ice_cream',
  cake: 'shortcake',
  lunch: 'hamburger',
  brunch: 'cooking',
};

const FALLBACK = RECIPE_CATEGORY_ICON_OPTIONS.find(o => o.key === 'cooking')!;

const BY_KEY = new Map(RECIPE_CATEGORY_ICON_OPTIONS.map(o => [o.key, o]));

function normalizeIconKey(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const key = raw.trim();
  if (BY_KEY.has(key)) return key;
  const alias = LEGACY_ICON_KEY_ALIASES[key];
  if (alias && BY_KEY.has(alias)) return alias;
  return null;
}

/** 按分类名猜测默认图标 key */
export function guessRecipeCategoryIconKey(name: string): string {
  const n = name.trim();
  if (/汤|羹|面|拉面|米线|粉/.test(n)) return 'steaming_bowl';
  if (/蒸|煮|炖|焖|煲|砂锅|火锅/.test(n)) return 'pot_of_food';
  if (/家常|下饭|炒/.test(n)) return 'cooking';
  if (/鱼|虾|蟹|龙虾|海鲜|贝/.test(n)) return /虾/.test(n) ? 'fried_shrimp' : /蟹|龙虾/.test(n) ? 'crab' : 'fish';
  if (/蔬|素|青菜|沙拉/.test(n)) return /沙拉/.test(n) ? 'green_salad' : 'leafy_green';
  if (/主食|饭|米|粥/.test(n)) return /粥/.test(n) ? 'bowl_with_spoon' : 'cooked_rice';
  if (/饺|包子|馄饨|dumpling/i.test(n)) return 'dumpling';
  if (/小吃|零食|炸|薯条/.test(n)) return 'french_fries';
  if (/饮料|饮|茶|咖|奶茶|酒/.test(n)) {
    if (/咖/.test(n)) return 'hot_beverage';
    if (/奶茶|波波|珍珠/.test(n)) return 'bubble_tea';
    if (/酒/.test(n)) return 'wine_glass';
    return 'teacup';
  }
  if (/烘焙|面包|可颂|酥/.test(n)) return 'croissant';
  if (/蛋糕|甜品|布丁|冰淇淋|甜/.test(n)) {
    if (/冰淇淋|冰淇/.test(n)) return 'ice_cream';
    if (/蛋糕/.test(n)) return 'shortcake';
    return 'cupcake';
  }
  if (/调味|酱|料|盐|油/.test(n)) return 'salt';
  if (/凉|冷/.test(n)) return 'green_salad';
  if (/蛋/.test(n)) return 'egg';
  if (/肉|鸡|鸭|牛|羊|猪/.test(n)) return 'cut_of_meat';
  if (/果|水果/.test(n)) return 'red_apple';
  return 'cooking';
}

export function resolveRecipeCategoryIcon(
  iconKey: string | null | undefined,
  name?: string,
  index = 0,
): RecipeCategoryIconOption {
  const normalized = normalizeIconKey(iconKey);
  if (normalized) return BY_KEY.get(normalized)!;
  if (name?.trim()) {
    const guessed = guessRecipeCategoryIconKey(name);
    if (BY_KEY.has(guessed)) return BY_KEY.get(guessed)!;
  }
  return RECIPE_CATEGORY_ICON_OPTIONS[index % RECIPE_CATEGORY_ICON_OPTIONS.length] ?? FALLBACK;
}

export function recipeCategoryIconsByGroup(): {
  group: RecipeCategoryIconGroup;
  label: string;
  icons: RecipeCategoryIconOption[];
}[] {
  const order: RecipeCategoryIconGroup[] = [
    'fruit',
    'veg',
    'staple',
    'meat',
    'seafood',
    'asian',
    'prepared',
    'sweet',
    'drink',
    'dishware',
  ];
  return order.map(group => ({
    group,
    label: RECIPE_CATEGORY_ICON_GROUP_LABELS[group],
    icons: RECIPE_CATEGORY_ICON_OPTIONS.filter(o => o.group === group),
  }));
}

/** 开发期断言：图标数量约 170 */
export const RECIPE_CATEGORY_ICON_COUNT = RECIPE_CATEGORY_ICON_OPTIONS.length;
