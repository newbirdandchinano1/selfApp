import type { SheetCategory } from '@/lib/finance-transaction-sheet/helpers';
import { FINANCE_SHEET_CATEGORY_ICON_OPTIONS } from '@/lib/constants/finance-sheet-category-icons';
import type { FinanceSheetTransactionType } from '@/lib/repositories/finance/finance-sheet-category';
import { MaterialIcons } from '@expo/vector-icons';

type MaterialIconName = keyof typeof MaterialIcons.glyphMap;
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const ICON_COLUMNS = 6;
const ICON_GAP = 8;
/** 与 categoryItem width: 20% 对应，单行最多 5 个 */
const CATEGORY_ITEMS_PER_ROW = 5;
const COLLAPSED_CATEGORY_COUNT = CATEGORY_ITEMS_PER_ROW - 1;

export type FinanceCategoryPickerStyles = {
  categoryGrid: object;
  categoryItem: object;
  categoryIconWrap: object;
  categoryLabel: object;
};

type FinanceCategoryPickerProps = {
  categories: SheetCategory[];
  selectedKey: string;
  onSelectKey: (key: string) => void;
  transactionType: FinanceSheetTransactionType;
  subtle: string;
  primary: string;
  text: string;
  surface: string;
  outlineVariant: string;
  styles: FinanceCategoryPickerStyles;
  onAddPress: () => void;
  onLongPressCustom?: (item: SheetCategory) => void;
  addModalVisible: boolean;
  newCategoryName: string;
  onChangeNewCategoryName: (v: string) => void;
  newCategoryIcon: MaterialIconName;
  onChangeNewCategoryIcon: (icon: MaterialIconName) => void;
  isSavingCategory: boolean;
  onCloseAddModal: () => void;
  onSaveNewCategory: () => void;
  /** 为 true 时默认只显示一行分类，其余通过展开查看 */
  singleRowCollapsed?: boolean;
};

export function FinanceCategoryPicker({
  categories,
  selectedKey,
  onSelectKey,
  transactionType,
  subtle,
  primary,
  text,
  surface,
  outlineVariant,
  styles: s,
  onAddPress,
  onLongPressCustom,
  addModalVisible,
  newCategoryName,
  onChangeNewCategoryName,
  newCategoryIcon,
  onChangeNewCategoryIcon,
  isSavingCategory,
  onCloseAddModal,
  onSaveNewCategory,
  singleRowCollapsed = false,
}: FinanceCategoryPickerProps) {
  const typeLabel = transactionType === 'income' ? '收入' : '支出';
  const [iconGridWidth, setIconGridWidth] = React.useState(0);
  const [categoriesExpanded, setCategoriesExpanded] = React.useState(false);
  const iconTileSize =
    iconGridWidth > 0
      ? Math.floor((iconGridWidth - ICON_GAP * (ICON_COLUMNS - 1)) / ICON_COLUMNS)
      : 0;

  const needsCollapse =
    singleRowCollapsed && categories.length + 1 > CATEGORY_ITEMS_PER_ROW;

  React.useEffect(() => {
    setCategoriesExpanded(false);
  }, [transactionType, categories.length]);

  const visibleCategories = React.useMemo(() => {
    if (!needsCollapse || categoriesExpanded) return categories;
    const first = categories.slice(0, COLLAPSED_CATEGORY_COUNT);
    if (first.some((item) => item.key === selectedKey)) return first;
    const selected = categories.find((item) => item.key === selectedKey);
    if (!selected) return first;
    return [...first.slice(0, COLLAPSED_CATEGORY_COUNT - 1), selected];
  }, [categories, categoriesExpanded, needsCollapse, selectedKey]);

  const renderCategoryItem = (item: SheetCategory) => {
    const isSelected = selectedKey === item.key;
    return (
      <Pressable
        key={item.key}
        style={s.categoryItem}
        onPress={() => onSelectKey(item.key)}
        onLongPress={item.isCustom && onLongPressCustom ? () => onLongPressCustom(item) : undefined}
        delayLongPress={400}
        accessibilityHint={item.isCustom ? '长按可删除自定义分类' : undefined}>
        <View
          style={[
            s.categoryIconWrap,
            {
              backgroundColor: isSelected ? `${item.color}20` : outlineVariant,
              borderColor: isSelected ? item.color : 'transparent',
            },
          ]}>
          <MaterialIcons name={item.icon} size={22} color={item.color} />
        </View>
        <Text style={[s.categoryLabel, { color: isSelected ? item.color : subtle }]} numberOfLines={1}>
          {item.label}
        </Text>
      </Pressable>
    );
  };

  const renderAddCategoryItem = () => (
    <Pressable
      style={s.categoryItem}
      onPress={onAddPress}
      accessibilityRole="button"
      accessibilityLabel={`添加自定义${typeLabel}分类`}>
      <View
        style={[
          s.categoryIconWrap,
          {
            backgroundColor: 'transparent',
            borderColor: outlineVariant,
            borderWidth: 1,
            borderStyle: 'dashed',
          },
        ]}>
        <MaterialIcons name="add" size={22} color={primary} />
      </View>
      <Text style={[s.categoryLabel, { color: primary }]} numberOfLines={1}>
        自定义
      </Text>
    </Pressable>
  );

  const renderToggleExpandItem = () => {
    const expanded = categoriesExpanded;
    return (
      <Pressable
        style={s.categoryItem}
        onPress={() => setCategoriesExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={expanded ? '收起分类' : '展开更多分类'}>
        <View
          style={[
            s.categoryIconWrap,
            {
              backgroundColor: expanded ? `${primary}12` : outlineVariant,
              borderColor: expanded ? primary : 'transparent',
            },
          ]}>
          <MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={24} color={primary} />
        </View>
        <Text style={[s.categoryLabel, { color: primary }]} numberOfLines={1}>
          {expanded ? '收起' : '更多'}
        </Text>
      </Pressable>
    );
  };

  const showAddInGrid = !needsCollapse || categoriesExpanded;
  const isCollapsedGrid = needsCollapse && !categoriesExpanded;

  return (
    <>
      <View style={[s.categoryGrid, isCollapsedGrid && pickerStyles.categoryGridCollapsed]}>
        {visibleCategories.map(renderCategoryItem)}
        {showAddInGrid ? renderAddCategoryItem() : null}
        {needsCollapse ? renderToggleExpandItem() : null}
      </View>

      <Modal visible={addModalVisible} transparent animationType="fade" onRequestClose={onCloseAddModal}>
        <View style={modalStyles.backdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={onCloseAddModal} />
          <View style={[modalStyles.card, { backgroundColor: surface }]}>
            <Text style={[modalStyles.title, { color: text }]}>添加{typeLabel}分类</Text>
            <Text style={[modalStyles.hint, { color: subtle }]}>例如：宠物、学习、兼职</Text>
            <TextInput
              value={newCategoryName}
              onChangeText={onChangeNewCategoryName}
              placeholder="分类名称"
              placeholderTextColor={subtle}
              maxLength={20}
              autoFocus={Platform.OS !== 'web'}
              style={[modalStyles.input, { color: text, borderColor: outlineVariant }]}
            />
            <Text style={[modalStyles.iconSectionLabel, { color: text }]}>选择图标</Text>
            <ScrollView
              style={modalStyles.iconScroll}
              contentContainerStyle={modalStyles.iconScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <View
                style={[modalStyles.iconGrid, { gap: ICON_GAP }]}
                onLayout={(e) => {
                  const w = e.nativeEvent.layout.width;
                  if (w > 0 && w !== iconGridWidth) setIconGridWidth(w);
                }}>
                {iconTileSize > 0
                  ? FINANCE_SHEET_CATEGORY_ICON_OPTIONS.map((item) => {
                      const active = newCategoryIcon === item.icon;
                      return (
                        <Pressable
                          key={item.key}
                          onPress={() => onChangeNewCategoryIcon(item.icon)}
                          style={[
                            modalStyles.iconTile,
                            {
                              width: iconTileSize,
                              height: iconTileSize,
                              backgroundColor: active ? `${primary}18` : outlineVariant,
                              borderColor: active ? primary : 'transparent',
                            },
                          ]}>
                          <MaterialIcons name={item.icon} size={22} color={active ? primary : subtle} />
                        </Pressable>
                      );
                    })
                  : null}
              </View>
            </ScrollView>
            <View style={modalStyles.actions}>
              <Pressable
                onPress={onCloseAddModal}
                disabled={isSavingCategory}
                style={({ pressed }) => [modalStyles.btn, pressed && { opacity: 0.8 }]}>
                <Text style={{ color: subtle, fontWeight: '700' }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={onSaveNewCategory}
                disabled={isSavingCategory}
                style={({ pressed }) => [modalStyles.btnPrimary, { backgroundColor: primary }, pressed && { opacity: 0.9 }]}>
                {isSavingCategory ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '800' }}>保存</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const pickerStyles = StyleSheet.create({
  categoryGridCollapsed: {
    flexWrap: 'nowrap',
    rowGap: 0,
  },
});

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    borderRadius: 16,
    padding: 20,
    gap: 10,
    maxHeight: '85%',
  },
  title: { fontSize: 18, fontWeight: '800' },
  hint: { fontSize: 13, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 16,
    marginTop: 4,
  },
  iconSectionLabel: { fontSize: 14, fontWeight: '700', marginTop: 4 },
  iconScroll: { maxHeight: 168 },
  iconScrollContent: { paddingBottom: 4 },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  iconTile: {
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  btn: { paddingVertical: 10, paddingHorizontal: 14 },
  btnPrimary: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    minWidth: 72,
    alignItems: 'center',
  },
});
