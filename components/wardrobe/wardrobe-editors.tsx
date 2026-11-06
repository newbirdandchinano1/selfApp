/**
 * 衣橱写表单：新建/编辑单品、搭配、分类、场合、衣橱、选项、身材。
 */
import { useWardrobeTheme, wardrobeFonts, wardrobeEm, type WardrobePalette } from '@/constants/wardrobe-theme';
import { toast } from '@/lib/app-feedback/toast-events';
import {
  createWardrobeCategory,
  createWardrobeCloset,
  createWardrobeItem,
  createWardrobeOccasion,
  createWardrobeOption,
  createWardrobeOutfit,
  defaultArtKeyForCategoryName,
  deleteWardrobeCategory,
  deleteWardrobeCloset,
  deleteWardrobeItem,
  deleteWardrobeOccasion,
  deleteWardrobeOption,
  deleteWardrobeOutfit,
  renameWardrobeCategory,
  saveWardrobeBodyProfile,
  setDefaultWardrobeCloset,
  updateWardrobeItem,
  updateWardrobeOutfit,
  type BodyProfileInput,
} from '@/lib/repositories/wardrobe/wardrobe-writes';
import {
  isUncategorizedCategory,
  type WardrobeItem,
  type WardrobeOutfit,
} from '@/components/wardrobe/data';
import {
  IconArrow,
  IconBack,
  IconCamera,
  IconCheck,
  IconClose,
  IconImage,
  IconPlus,
} from '@/components/wardrobe/icons';
import {
  bindWardrobeItemImages,
  ensureWardrobeItemRemoteImages,
  pickWardrobeLocalImage,
  prepareWardrobeImagesFromLocal,
  releaseReplacedWardrobeImages,
  type WardrobeImageSource,
} from '@/lib/wardrobe-images';
import { buildWardrobeOptionHints } from '@/lib/wardrobe-ai-context';
import {
  isStoredImageUri,
  readLocalImageDataUrl,
  resolveStoredImageDisplayUri,
} from '@/lib/stored-images';
import { parseWardrobeItemFromImage, parseWardrobeItemFromText } from '@/lib/zhipu-image-parse';
import { toUserMessage } from '@/lib/app-feedback';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

function promptWardrobeImageSource(
  onPick: (source: WardrobeImageSource) => void,
): void {
  Alert.alert('添加单品图片', undefined, [
    { text: '拍照', onPress: () => onPick('camera') },
    { text: '从相册选择', onPress: () => onPick('library') },
    { text: '取消', style: 'cancel' },
  ]);
}

function guessColorSwatch(color: string, fallback: string): string {
  const t = color.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(t)) return t;
  return fallback;
}

export type WardrobeEditor =
  | {
      type: 'item';
      mode: 'create' | 'edit';
      closetId: string;
      categoryId?: string;
      categoryHint?: string;
      categories: { id: string; name: string }[];
      /** 衣橱设置里的颜色 / 季节 / 版型等词条 */
      options?: { id: string; kind: string; value: string }[];
      item?: WardrobeItem & { category_id?: string; price_yuan?: number };
      /** FAB 拍照 / 相册导入后的种子主图 */
      seedImageUri?: string;
      /** FAB 导入后已抠好的透明图 */
      seedCutoutUri?: string;
    }
  | {
      type: 'outfit';
      mode: 'create' | 'edit';
      closetId: string;
      occasions: { id: string; name: string }[];
      items: WardrobeItem[];
      outfit?: WardrobeOutfit;
      occasionId?: string | null;
      seedItemIds?: string[];
    }
  | {
      type: 'category';
      mode: 'create' | 'rename';
      closetId: string;
      categoryId?: string;
      name?: string;
    }
  | { type: 'occasion'; mode: 'create'; name?: string }
  | { type: 'closet'; mode: 'create' }
  | {
      type: 'option';
      kind: 'color' | 'brand' | 'season' | 'fit';
      closetId?: string;
    }
  | {
      type: 'body';
      closetId: string;
      profile: BodyProfileInput;
    }
  | {
      type: 'confirm-delete';
      target: 'item' | 'outfit' | 'category' | 'occasion' | 'closet' | 'option';
      id: string;
      label: string;
    };

type Props = {
  editor: WardrobeEditor | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  multiline?: boolean;
}) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={w.muted2}
        keyboardType={keyboardType}
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMulti]}
      />
    </View>
  );
}

function ChipSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {options.map((opt) => {
          const active = opt.id === value;
          return (
            <Pressable
              key={opt.id}
              onPress={() => onChange(opt.id)}
              style={[styles.chip, active && styles.chipOn]}>
              <Text style={[styles.chipText, active && styles.chipTextOn]}>{opt.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export const WardrobeEditorHost = memo(function WardrobeEditorHost({
  editor,
  onClose,
  onSaved,
}: Props) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  if (!editor) return null;

  if (editor.type === 'item') {
    return (
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <View style={[styles.itemRoot, { paddingTop: insets.top + 4, paddingBottom: insets.bottom + 8 }]}>
          <ItemForm
            editor={editor}
            busy={busy}
            setBusy={setBusy}
            onClose={onClose}
            onSaved={onSaved}
          />
        </View>
      </Modal>
    );
  }

  // 确认删除：底栏内容高度 Sheet，避免全屏大片空白
  if (editor.type === 'confirm-delete') {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.deleteBackdrop}>
          <Pressable style={styles.deleteDismiss} onPress={onClose} accessibilityLabel="关闭确认删除" />
          <View style={[styles.deleteSheet, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
            <View style={styles.deleteHandle} />
            <Text style={styles.deleteKicker}>DELETE</Text>
            <Text style={styles.deleteTitle}>确认删除</Text>
            <DeleteForm
              editor={editor}
              busy={busy}
              setBusy={setBusy}
              onClose={onClose}
              onSaved={onSaved}
            />
          </View>
        </View>
      </Modal>
    );
  }

  const title =
    editor.type === 'outfit'
      ? editor.mode === 'edit'
        ? '编辑搭配'
        : '新建搭配'
      : editor.type === 'category'
        ? editor.mode === 'rename'
          ? '重命名分类'
          : '新建分类'
        : editor.type === 'occasion'
          ? '新建场合'
          : editor.type === 'closet'
            ? '新建衣橱'
            : editor.type === 'option'
              ? `添加${{ color: '颜色', brand: '品牌', season: '季节', fit: '版型' }[editor.kind]}`
              : '身材与尺码';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.head}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} style={styles.closeBtn} accessibilityLabel="关闭">
            <IconClose size={16} color={w.ink2} />
          </Pressable>
        </View>
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled">
          {editor.type === 'outfit' ? (
            <OutfitForm
              editor={editor}
              busy={busy}
              setBusy={setBusy}
              onClose={onClose}
              onSaved={onSaved}
            />
          ) : null}
          {editor.type === 'category' || editor.type === 'occasion' || editor.type === 'closet' ? (
            <NameForm
              editor={editor}
              busy={busy}
              setBusy={setBusy}
              onClose={onClose}
              onSaved={onSaved}
            />
          ) : null}
          {editor.type === 'option' ? (
            <OptionForm
              editor={editor}
              busy={busy}
              setBusy={setBusy}
              onClose={onClose}
              onSaved={onSaved}
            />
          ) : null}
          {editor.type === 'body' ? (
            <BodyForm
              editor={editor}
              busy={busy}
              setBusy={setBusy}
              onClose={onClose}
              onSaved={onSaved}
            />
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
});

function normalizePurchasedOn(raw: string): string | null {
  const t = raw.trim().replace(/[./]/g, '-');
  if (!t) return null;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) {
    const [y, m, d] = t.split('-');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function ymdToDate(ymd: string): Date {
  const n = normalizePurchasedOn(ymd);
  if (!n) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const [y, m, d] = n.split('-').map((x) => Number(x));
  return new Date(y, m - 1, d);
}

function dateToYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatYmdDisplay(ymd: string): string {
  const n = normalizePurchasedOn(ymd);
  return n ? n.replace(/-/g, '.') : '';
}

function optionValuesFor(
  options: { id: string; kind: string; value: string }[] | undefined,
  kind: string,
  current?: string,
): string[] {
  const list = (options ?? [])
    .filter((o) => o.kind === kind)
    .map((o) => o.value.trim())
    .filter(Boolean);
  const cur = (current ?? '').trim();
  if (cur && !list.includes(cur)) return [cur, ...list];
  return list;
}

function sameYmd(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildMonthCells(year: number, month: number): ({ ymd: string; day: number } | null)[] {
  const first = new Date(year, month, 1);
  const pad = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: ({ ymd: string; day: number } | null)[] = [];
  for (let i = 0; i < pad; i++) cells.push(null);
  for (let d = 1; d <= days; d++) {
    cells.push({ ymd: dateToYmd(new Date(year, month, d)), day: d });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function PurchaseDateSheet({
  visible,
  value,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  value: string;
  onClose: () => void;
  onConfirm: (ymd: string) => void;
}) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  const insets = useSafeAreaInsets();
  const initial = useMemo(() => ymdToDate(value), [value]);
  const [selected, setSelected] = useState(initial);
  const [cursor, setCursor] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1));

  useEffect(() => {
    if (!visible) return;
    const next = ymdToDate(value);
    setSelected(next);
    setCursor(new Date(next.getFullYear(), next.getMonth(), 1));
  }, [visible, value]);

  const cells = useMemo(
    () => buildMonthCells(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const shiftMonth = (delta: number) => {
    setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const selectedLabel = formatYmdDisplay(dateToYmd(selected));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.dateBackdrop}>
        <Pressable style={styles.dateDismiss} onPress={onClose} accessibilityLabel="关闭日期选择" />
        <View style={[styles.dateSheet, { paddingBottom: Math.max(insets.bottom, 12) + 6 }]}>
          <View style={styles.dateHandle} />
          <View style={styles.dateHead}>
            <Text style={styles.dateKicker}>PURCHASE DATE</Text>
            <Text style={styles.dateTitle}>选择购买日期</Text>
          </View>

          <View style={styles.dateMonthBar}>
            <Pressable
              style={styles.dateNavBtn}
              onPress={() => shiftMonth(-1)}
              accessibilityLabel="上一月">
              <View style={styles.dateNavFlip}>
                <IconArrow size={14} color={w.ink2} />
              </View>
            </Pressable>
            <Text style={styles.dateSelected}>{selectedLabel || '未选择'}</Text>
            <Pressable
              style={styles.dateNavBtn}
              onPress={() => shiftMonth(1)}
              accessibilityLabel="下一月">
              <IconArrow size={14} color={w.ink2} />
            </Pressable>
          </View>

          <View style={styles.dateWeekRow}>
            {WEEKDAY_LABELS.map((label) => (
              <Text key={label} style={styles.dateWeekLabel}>
                {label}
              </Text>
            ))}
          </View>

          <View style={styles.dateGrid}>
            {cells.map((cell, idx) => {
              if (!cell) {
                return <View key={`e-${idx}`} style={styles.dateCell} />;
              }
              const cellDate = ymdToDate(cell.ymd);
              const isSelected = sameYmd(cellDate, selected);
              const isToday = sameYmd(cellDate, today);
              return (
                <Pressable
                  key={cell.ymd}
                  style={styles.dateCell}
                  onPress={() => setSelected(cellDate)}>
                  <View
                    style={[
                      styles.dateDay,
                      isToday && !isSelected && styles.dateDayToday,
                      isSelected && styles.dateDayOn,
                    ]}>
                    <Text
                      style={[
                        styles.dateDayText,
                        isToday && !isSelected && styles.dateDayTextToday,
                        isSelected && styles.dateDayTextOn,
                      ]}>
                      {cell.day}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.dateQuickRow}>
            <Pressable
              style={styles.dateQuick}
              onPress={() => {
                setSelected(today);
                setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
              }}>
              <Text style={styles.dateQuickText}>今天</Text>
            </Pressable>
            <Pressable
              style={styles.dateQuick}
              onPress={() => {
                onConfirm('');
                onClose();
              }}>
              <Text style={styles.dateQuickText}>清除</Text>
            </Pressable>
          </View>

          <View style={styles.dateActions}>
            <Pressable style={styles.dateGhost} onPress={onClose}>
              <Text style={styles.dateGhostText}>取消</Text>
            </Pressable>
            <Pressable
              style={styles.dateConfirm}
              onPress={() => {
                onConfirm(dateToYmd(selected));
                onClose();
              }}>
              <Text style={styles.dateConfirmText}>确定</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function FormRow({
  label,
  children,
  last,
  onPress,
}: {
  label: string;
  children?: React.ReactNode;
  last?: boolean;
  onPress?: () => void;
}) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  const body = (
    <>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowTrailing}>{children}</View>
      <IconArrow size={14} color={w.muted2} />
    </>
  );
  if (onPress) {
    return (
      <Pressable style={[styles.formRow, last && styles.formRowLast]} onPress={onPress}>
        {body}
      </Pressable>
    );
  }
  return <View style={[styles.formRow, last && styles.formRowLast]}>{body}</View>;
}

function RowInput({
  value,
  onChange,
  placeholder,
  keyboardType,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad' | 'url';
}) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={w.muted2}
      keyboardType={keyboardType}
      style={styles.rowInput}
    />
  );
}

function OptionChipPicker({
  values,
  selected,
  emptyHint,
  onSelect,
  showColorDot,
}: {
  values: string[];
  selected: string;
  emptyHint: string;
  onSelect: (v: string) => void;
  showColorDot?: boolean;
}) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  if (!values.length) {
    return (
      <View style={styles.inlinePicker}>
        <Text style={styles.inlineEmpty}>{emptyHint}</Text>
      </View>
    );
  }
  return (
    <View style={styles.inlinePicker}>
      {values.map((opt) => {
        const on = opt === selected;
        return (
          <Pressable
            key={opt}
            style={[styles.chip, on && styles.chipOn]}
            onPress={() => onSelect(opt)}>
            {showColorDot ? (
              <View style={[styles.chipColorDot, { backgroundColor: guessColorSwatch(opt, w.sage) }]} />
            ) : null}
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ItemForm({
  editor,
  busy,
  setBusy,
  onClose,
  onSaved,
}: {
  editor: Extract<WardrobeEditor, { type: 'item' }>;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  /** 「未分类」仅作删分类后的归宿，表单里不可选手选 */
  const selectableCategories = useMemo(
    () => editor.categories.filter((c) => !isUncategorizedCategory(c.name)),
    [editor.categories],
  );
  const seasonDefaults = useMemo(
    () => optionValuesFor(editor.options, 'season'),
    [editor.options],
  );
  const [name, setName] = useState(editor.item?.name ?? '');
  const [categoryId, setCategoryId] = useState(() => {
    const preferred = editor.item?.category_id || editor.categoryId || '';
    const preferredMeta = editor.categories.find((c) => c.id === preferred);
    if (preferredMeta && !isUncategorizedCategory(preferredMeta.name)) return preferred;
    // 编辑态：单品已在未分类时保留现状，仅禁止再选回未分类
    if (editor.mode === 'edit' && preferred) return preferred;
    return selectableCategories[0]?.id ?? '';
  });
  const [season, setSeason] = useState(() => {
    if (editor.item?.season) return editor.item.season.replace(/\s*\/\s*/g, '/');
    if (editor.mode !== 'create') return '';
    return seasonDefaults.find((s) => s === '四季') ?? seasonDefaults[0] ?? '';
  });
  const [color, setColor] = useState(editor.item?.color === '—' ? '' : editor.item?.color ?? '');
  const [brand, setBrand] = useState(editor.item?.brand === '—' ? '' : editor.item?.brand ?? '');
  const [price, setPrice] = useState(
    editor.item?.price_yuan != null
      ? String(editor.item.price_yuan)
      : editor.item?.price
        ? String(Number(editor.item.price.replace(/[^\d.]/g, '')) || '')
        : '',
  );
  const [fit, setFit] = useState(editor.item?.fit === '—' ? '' : editor.item?.fit ?? '');
  const [purchasedOn, setPurchasedOn] = useState(editor.item?.purchased_on ?? '');
  const [note, setNote] = useState(editor.item?.note ?? '');
  const [imageUri, setImageUri] = useState(
    editor.seedImageUri?.trim() || editor.item?.image_uri || '',
  );
  const [cutoutUri, setCutoutUri] = useState(
    editor.seedCutoutUri?.trim() || editor.item?.cutout_uri || '',
  );
  const [noteImageUri, setNoteImageUri] = useState(editor.item?.note_image_uri ?? '');
  const [imageBusy, setImageBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const aiGenRef = useRef(0);
  const [oneLinerOpen, setOneLinerOpen] = useState(false);
  const [oneLinerText, setOneLinerText] = useState('');
  const [picker, setPicker] = useState<'category' | 'season' | 'color' | 'brand' | 'fit' | null>(
    null,
  );
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  useEffect(() => {
    if (!categoryId && selectableCategories[0]) setCategoryId(selectableCategories[0].id);
  }, [categoryId, selectableCategories]);

  const readImageDataUrlForAi = useCallback(async (uri: string): Promise<string> => {
    const raw = uri.trim();
    if (!raw) throw new Error('请先添加单品图片');
    if (raw.toLowerCase().startsWith('data:')) return raw;
    if (isStoredImageUri(raw) || raw.startsWith('/uploads/') || /^https?:\/\//i.test(raw)) {
      const display = await resolveStoredImageDisplayUri(raw);
      if (!display) throw new Error('无法读取图片');
      return readLocalImageDataUrl(display);
    }
    return readLocalImageDataUrl(raw);
  }, []);

  const applyItemDraft = useCallback(
    (d: {
      name: string;
      category_hint: string | null;
      color: string;
      season: string;
      brand: string;
      fit: string;
    }) => {
      if (d.name.trim()) setName(d.name.trim());
      if (d.category_hint) {
        const match = selectableCategories.find((c) => c.name === d.category_hint);
        if (match) setCategoryId(match.id);
      }
      if (d.season.trim()) setSeason(d.season.replace(/\s*\/\s*/g, '/'));
      if (d.color.trim()) setColor(d.color.trim());
      if (d.brand.trim()) setBrand(d.brand.trim());
      if (d.fit.trim()) setFit(d.fit.trim());
    },
    [selectableCategories],
  );

  const runAiFillAttrs = useCallback(async () => {
    if (busy || imageBusy || aiBusy) return;
    const sourceUri = cutoutUri.trim() || imageUri.trim();
    if (!sourceUri) {
      toast.info('请先拍照或导入单品图');
      return;
    }
    const gen = ++aiGenRef.current;
    setAiBusy(true);
    try {
      const dataUrl = await readImageDataUrlForAi(sourceUri);
      const categoryNames = selectableCategories.map((c) => c.name);
      const optionHints = buildWardrobeOptionHints(editor.options);
      const r = await parseWardrobeItemFromImage({
        imageBase64: dataUrl,
        categoryNames,
        optionHints,
      });
      if (gen !== aiGenRef.current) return;
      if (!r.ok) {
        toast.info(r.error || 'AI 识别失败');
        return;
      }
      applyItemDraft(r.data);
      toast.info('已填入属性，请确认后保存');
    } catch (e) {
      if (gen !== aiGenRef.current) return;
      toast.info(toUserMessage(e, 'AI 识别失败'));
    } finally {
      if (gen === aiGenRef.current) setAiBusy(false);
    }
  }, [
    aiBusy,
    applyItemDraft,
    busy,
    cutoutUri,
    editor.options,
    imageBusy,
    imageUri,
    readImageDataUrlForAi,
    selectableCategories,
  ]);

  const runAiFillAttrsFromText = useCallback(async () => {
    if (busy || imageBusy || aiBusy) return;
    const text = oneLinerText.trim();
    if (!text) {
      toast.info('请输入一句话描述');
      return;
    }
    const gen = ++aiGenRef.current;
    setAiBusy(true);
    try {
      const r = await parseWardrobeItemFromText({
        text,
        categoryNames: selectableCategories.map((c) => c.name),
        optionHints: buildWardrobeOptionHints(editor.options),
      });
      if (gen !== aiGenRef.current) return;
      if (!r.ok) {
        toast.info(r.error || 'AI 解析失败');
        return;
      }
      applyItemDraft(r.data);
      setOneLinerOpen(false);
      setOneLinerText('');
      toast.info('已填入属性，请确认后保存');
    } catch (e) {
      if (gen !== aiGenRef.current) return;
      toast.info(toUserMessage(e, 'AI 解析失败'));
    } finally {
      if (gen === aiGenRef.current) setAiBusy(false);
    }
  }, [
    aiBusy,
    applyItemDraft,
    busy,
    editor.options,
    imageBusy,
    oneLinerText,
    selectableCategories,
  ]);

  const categoryName = editor.categories.find((c) => c.id === categoryId)?.name ?? '';
  const colorSwatch = guessColorSwatch(color, w.pine);
  const hasCutout = Boolean(cutoutUri.trim());
  const heroPreviewUri = cutoutUri.trim() || imageUri.trim();
  const seasonValues = useMemo(
    () => optionValuesFor(editor.options, 'season', season),
    [editor.options, season],
  );
  const colorValues = useMemo(
    () => optionValuesFor(editor.options, 'color', color),
    [editor.options, color],
  );
  const fitValues = useMemo(
    () => optionValuesFor(editor.options, 'fit', fit),
    [editor.options, fit],
  );
  const brandValues = useMemo(
    () => optionValuesFor(editor.options, 'brand', brand),
    [editor.options, brand],
  );

  const applyHeroFromSource = useCallback(async (source: WardrobeImageSource) => {
    if (imageBusy) return;
    setImageBusy(true);
    try {
      const picked = await pickWardrobeLocalImage(source);
      if (!picked.ok) {
        if (picked.reason === 'permission') {
          toast.info(source === 'camera' ? '需要相机权限才能拍照' : '需要相册权限才能选图');
        }
        return;
      }
      const prepared = await prepareWardrobeImagesFromLocal(picked.uri);
      setImageUri(prepared.imageUri);
      setCutoutUri(prepared.cutoutUri ?? '');
      if (prepared.cutoutApplied) {
        toast.info('已完成抠图');
      } else {
        toast.info('已导入原图（当前环境暂不可用抠图）');
      }
    } catch (e) {
      toast.info(e instanceof Error ? e.message : '选图失败');
    } finally {
      setImageBusy(false);
    }
  }, [imageBusy]);

  const pickHero = useCallback(() => {
    if (imageBusy || busy) return;
    promptWardrobeImageSource((source) => {
      void applyHeroFromSource(source);
    });
  }, [applyHeroFromSource, busy, imageBusy]);

  const pickNoteImage = useCallback(async () => {
    if (imageBusy || busy) return;
    const picked = await pickWardrobeLocalImage('library');
    if (!picked.ok) {
      if (picked.reason === 'permission') toast.info('需要相册权限才能选图');
      return;
    }
    setNoteImageUri(picked.uri);
  }, [busy, imageBusy]);

  const submit = async () => {
    if (busy || imageBusy) return;
    setBusy(true);
    try {
      const catMeta = editor.categories.find((c) => c.id === categoryId);
      if (editor.mode === 'create') {
        if (!catMeta || isUncategorizedCategory(catMeta.name)) {
          toast.info('请选择分类');
          return;
        }
      }
      const catName = catMeta?.name ?? '未分类';
      const priceYuan = price.trim() ? Number(price.trim()) : null;
      const purchased = normalizePurchasedOn(purchasedOn);
      const itemId = editor.mode === 'edit' ? editor.item?.id : undefined;
      const remote = await ensureWardrobeItemRemoteImages({
        itemId,
        image_uri: imageUri.trim() || undefined,
        cutout_uri: cutoutUri.trim() || undefined,
        note_image_uri: noteImageUri.trim() || undefined,
      });

      if (editor.mode === 'edit' && editor.item) {
        await releaseReplacedWardrobeImages(
          {
            image_uri: editor.item.image_uri,
            cutout_uri: editor.item.cutout_uri,
            note_image_uri: editor.item.note_image_uri,
          },
          remote,
        );
      }

      const payload = {
        closet_id: editor.closetId,
        category_id: categoryId,
        name,
        brand,
        color,
        season: season.replace(/\s+/g, ''),
        price_yuan: priceYuan != null && Number.isFinite(priceYuan) ? priceYuan : null,
        fit,
        purchased_on: purchased,
        note,
        image_uri: remote.image_uri,
        /** 编辑时显式传空串以清掉旧抠图 */
        cutout_uri: remote.cutout_uri ?? (editor.mode === 'edit' ? '' : undefined),
        note_image_uri: remote.note_image_uri ?? (editor.mode === 'edit' ? '' : undefined),
        art_key: defaultArtKeyForCategoryName(catName),
      };
      const res =
        editor.mode === 'edit' && editor.item
          ? await updateWardrobeItem(editor.item.id, payload)
          : await createWardrobeItem(payload);
      if (!res.ok) {
        toast.info(res.error || '保存失败');
        return;
      }
      if (res.id) {
        await bindWardrobeItemImages(res.id, remote);
      }
      toast.info(editor.mode === 'edit' ? '单品已更新' : '单品已添加');
      await onSaved();
      onClose();
    } catch (e) {
      toast.info(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.itemShell}>
      <View style={styles.itemHead}>
        <Pressable onPress={onClose} style={styles.itemHeadBtn} accessibilityLabel="返回">
          <IconBack size={18} color={w.ink2} />
        </Pressable>
        <Text style={styles.itemHeadTitle}>{editor.mode === 'edit' ? '编辑单品' : '创建单品'}</Text>
        <Pressable
          style={[styles.itemSaveBtn, busy && styles.btnDisabled]}
          onPress={() => void submit()}
          disabled={busy}>
          {busy ? (
            <ActivityIndicator color={w.onPine} size="small" />
          ) : (
            <Text style={styles.itemSaveText}>保存</Text>
          )}
        </Pressable>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.itemBodyContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Pressable
          style={[styles.heroCard, hasCutout && styles.heroCardCutout]}
          onPress={pickHero}
          disabled={imageBusy || busy}
          accessibilityLabel="添加或更换单品图片">
          {hasCutout ? (
            <View style={styles.heroChecker} pointerEvents="none">
              {Array.from({ length: 64 }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.heroCheckerCell,
                    {
                      backgroundColor:
                        (Math.floor(i / 8) + (i % 8)) % 2 === 0 ? w.paper2 : w.card,
                    },
                  ]}
                />
              ))}
            </View>
          ) : null}
          {heroPreviewUri ? (
            <Image
              source={{ uri: heroPreviewUri }}
              style={styles.heroImage}
              resizeMode={hasCutout ? 'contain' : 'cover'}
            />
          ) : (
            <View style={styles.heroEmpty}>
              <IconCamera size={28} color={w.muted} />
              <Text style={styles.heroEmptyText}>拍照或从相册导入</Text>
            </View>
          )}
          {imageBusy ? (
            <View style={styles.heroBusyMask}>
              <ActivityIndicator color={w.pine} />
              <Text style={styles.heroBusyText}>处理中…</Text>
            </View>
          ) : null}
          {hasCutout && !imageBusy ? (
            <View style={styles.heroCutoutBadge}>
              <Text style={styles.heroCutoutBadgeText}>已抠图</Text>
            </View>
          ) : null}
          <View style={styles.heroGalleryBtn}>
            <IconImage size={14} color={w.pine} />
          </View>
        </Pressable>

        <View style={styles.aiFillRow}>
          <Pressable
            style={[styles.aiFillBtn, (aiBusy || imageBusy || busy) && styles.btnDisabled]}
            onPress={() => void runAiFillAttrs()}
            disabled={aiBusy || imageBusy || busy}
            accessibilityLabel="AI 填属性">
            {aiBusy && !oneLinerOpen ? (
              <ActivityIndicator color={w.pine} size="small" />
            ) : (
              <Text style={styles.aiFillBtnText}>AI 填属性</Text>
            )}
          </Pressable>
          <Pressable
            style={[styles.aiFillBtn, (aiBusy || imageBusy || busy) && styles.btnDisabled]}
            onPress={() => setOneLinerOpen(true)}
            disabled={aiBusy || imageBusy || busy}
            accessibilityLabel="一句话添加">
            <Text style={styles.aiFillBtnText}>一句话添加</Text>
          </Pressable>
        </View>

        <Modal
          visible={oneLinerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => !aiBusy && setOneLinerOpen(false)}>
          <KeyboardAvoidingView
            style={styles.oneLinerBackdrop}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => !aiBusy && setOneLinerOpen(false)}
            />
            <View style={styles.oneLinerCard}>
              <Text style={styles.oneLinerTitle}>一句话添加</Text>
              <Text style={styles.oneLinerSub}>例如：优衣库米色羊毛大衣 秋冬 L</Text>
              <TextInput
                style={styles.oneLinerInput}
                value={oneLinerText}
                onChangeText={setOneLinerText}
                placeholder="描述品牌、颜色、品类…"
                placeholderTextColor={w.muted}
                multiline
                editable={!aiBusy}
                autoFocus
              />
              <View style={styles.oneLinerActions}>
                <Pressable
                  style={styles.oneLinerGhost}
                  disabled={aiBusy}
                  onPress={() => {
                    setOneLinerOpen(false);
                    setOneLinerText('');
                  }}>
                  <Text style={styles.oneLinerGhostText}>取消</Text>
                </Pressable>
                <Pressable
                  style={[styles.oneLinerPrimary, aiBusy && styles.btnDisabled]}
                  disabled={aiBusy}
                  onPress={() => void runAiFillAttrsFromText()}>
                  {aiBusy ? (
                    <ActivityIndicator color={w.onPine} size="small" />
                  ) : (
                    <Text style={styles.oneLinerPrimaryText}>AI 填入</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <View style={styles.formGroup}>
          <FormRow label="名称">
            <RowInput value={name} onChange={setName} placeholder="单品名称" />
          </FormRow>
          <FormRow
            label="分类"
            onPress={() => setPicker((p) => (p === 'category' ? null : 'category'))}>
            <Text style={[styles.rowValue, !categoryName && styles.rowPlaceholder]}>
              {categoryName || '选择分类'}
            </Text>
          </FormRow>
          {picker === 'category' ? (
            <View style={styles.inlinePicker}>
              {selectableCategories.length ? (
                selectableCategories.map((opt) => {
                  const on = opt.id === categoryId;
                  return (
                    <Pressable
                      key={opt.id}
                      style={[styles.chip, on && styles.chipOn]}
                      onPress={() => {
                        setCategoryId(opt.id);
                        setPicker(null);
                      }}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{opt.name}</Text>
                    </Pressable>
                  );
                })
              ) : (
                <Text style={styles.inlineEmpty}>暂无可用分类，请先在衣橱设置添加</Text>
              )}
            </View>
          ) : null}
          <FormRow
            label="季节"
            onPress={() => setPicker((p) => (p === 'season' ? null : 'season'))}>
            {season ? (
              <View style={styles.seasonPill}>
                <Text style={styles.seasonPillText}>{season}</Text>
              </View>
            ) : (
              <Text style={styles.rowPlaceholder}>选择季节</Text>
            )}
          </FormRow>
          {picker === 'season' ? (
            <OptionChipPicker
              values={seasonValues}
              selected={season}
              emptyHint="暂无季节，请先在衣橱设置添加"
              onSelect={(v) => {
                setSeason(v);
                setPicker(null);
              }}
            />
          ) : null}
          <FormRow
            label="颜色"
            last
            onPress={() => setPicker((p) => (p === 'color' ? null : 'color'))}>
            {color ? (
              <>
                <View style={[styles.colorDot, { backgroundColor: colorSwatch }]} />
                <Text style={styles.rowValue}>{color}</Text>
              </>
            ) : (
              <Text style={styles.rowPlaceholder}>选择颜色</Text>
            )}
          </FormRow>
          {picker === 'color' ? (
            <OptionChipPicker
              values={colorValues}
              selected={color}
              emptyHint="暂无颜色，请先在衣橱设置添加"
              showColorDot
              onSelect={(v) => {
                setColor(v);
                setPicker(null);
              }}
            />
          ) : null}
        </View>

        <View style={styles.formGroup}>
          <FormRow
            label="品牌"
            onPress={() => setPicker((p) => (p === 'brand' ? null : 'brand'))}>
            <Text style={[styles.rowValue, !brand && styles.rowPlaceholder]}>
              {brand || '选择品牌'}
            </Text>
          </FormRow>
          {picker === 'brand' ? (
            <OptionChipPicker
              values={brandValues}
              selected={brand}
              emptyHint="暂无品牌，请先在衣橱设置添加"
              onSelect={(v) => {
                setBrand(v);
                setPicker(null);
              }}
            />
          ) : null}
          <FormRow label="价格">
            <RowInput
              value={price}
              onChange={setPrice}
              placeholder="单品价格"
              keyboardType="decimal-pad"
            />
          </FormRow>
          <FormRow
            label="尺码"
            onPress={() => setPicker((p) => (p === 'fit' ? null : 'fit'))}>
            <Text style={[styles.rowValue, !fit && styles.rowPlaceholder]}>
              {fit || '选择版型'}
            </Text>
          </FormRow>
          {picker === 'fit' ? (
            <OptionChipPicker
              values={fitValues}
              selected={fit}
              emptyHint="暂无版型，请先在衣橱设置添加"
              onSelect={(v) => {
                setFit(v);
                setPicker(null);
              }}
            />
          ) : null}
          <FormRow label="购买日期" last onPress={() => setDatePickerOpen(true)}>
            <Text style={[styles.rowValue, !purchasedOn && styles.rowPlaceholder]}>
              {purchasedOn ? formatYmdDisplay(purchasedOn) : '选择日期'}
            </Text>
          </FormRow>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.noteHead}>备注</Text>
          <View style={styles.noteBody}>
            <Pressable style={styles.noteAdd} onPress={() => void pickNoteImage()}>
              {noteImageUri ? (
                <Image source={{ uri: noteImageUri }} style={styles.noteAddImg} resizeMode="cover" />
              ) : (
                <IconPlus size={18} color={w.muted} />
              )}
            </Pressable>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="描述这个单品，可用于关键字搜索"
              placeholderTextColor={w.muted2}
              multiline
              style={styles.noteInput}
            />
          </View>
        </View>
      </ScrollView>

      <PurchaseDateSheet
        visible={datePickerOpen}
        value={purchasedOn}
        onClose={() => setDatePickerOpen(false)}
        onConfirm={(ymd) => setPurchasedOn(ymd)}
      />
    </View>
  );
}

function OutfitForm({
  editor,
  busy,
  setBusy,
  onClose,
  onSaved,
}: {
  editor: Extract<WardrobeEditor, { type: 'outfit' }>;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  const [name, setName] = useState(editor.outfit?.name ?? '');
  const [note, setNote] = useState(editor.outfit?.note ?? '');
  const [occasionId, setOccasionId] = useState(editor.occasionId ?? editor.occasions[0]?.id ?? '');
  const [selected, setSelected] = useState<string[]>(
    editor.outfit?.items ?? editor.seedItemIds ?? [],
  );

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res =
        editor.mode === 'edit' && editor.outfit
          ? await updateWardrobeOutfit(editor.outfit.id, {
              name,
              note,
              occasion_id: occasionId || null,
              item_ids: selected,
            })
          : await createWardrobeOutfit({
              closet_id: editor.closetId,
              name,
              note,
              occasion_id: occasionId || null,
              item_ids: selected,
            });
      if (!res.ok) {
        toast.info(res.error || '保存失败');
        return;
      }
      toast.info(editor.mode === 'edit' ? '搭配已更新' : '搭配已保存');
      await onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Field label="名称" value={name} onChange={setName} placeholder="例如：初秋的通勤" />
      <ChipSelect
        label="场合"
        options={editor.occasions}
        value={occasionId}
        onChange={setOccasionId}
      />
      <Field label="备注" value={note} onChange={setNote} placeholder="可选" multiline />
      <Text style={styles.fieldLabel}>选择单品（已选 {selected.length}）</Text>
      <View style={styles.itemPickList}>
        {editor.items.map((item) => {
          const on = selected.includes(item.id);
          return (
            <Pressable key={item.id} style={[styles.itemPick, on && styles.itemPickOn]} onPress={() => toggle(item.id)}>
              <View style={styles.itemPickCopy}>
                <Text style={styles.itemPickTitle}>{item.name}</Text>
                <Text style={styles.itemPickNote}>
                  {item.category} · {item.brand}
                </Text>
              </View>
              {on ? <IconCheck size={14} color={w.pine} /> : <View style={styles.radio} />}
            </Pressable>
          );
        })}
      </View>
      <Pressable style={[styles.primaryBtn, busy && styles.btnDisabled]} onPress={() => void submit()}>
        {busy ? <ActivityIndicator color={w.onPine} /> : <Text style={styles.primaryBtnText}>保存搭配</Text>}
      </Pressable>
    </View>
  );
}

function NameForm({
  editor,
  busy,
  setBusy,
  onClose,
  onSaved,
}: {
  editor: Extract<WardrobeEditor, { type: 'category' | 'occasion' | 'closet' }>;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  const [name, setName] = useState(
    editor.type === 'category' ? editor.name ?? '' : editor.type === 'occasion' ? editor.name ?? '' : '',
  );

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let res;
      if (editor.type === 'category') {
        res =
          editor.mode === 'rename' && editor.categoryId
            ? await renameWardrobeCategory(editor.categoryId, name)
            : await createWardrobeCategory({ closet_id: editor.closetId, name });
      } else if (editor.type === 'occasion') {
        res = await createWardrobeOccasion(name);
      } else {
        res = await createWardrobeCloset(name);
      }
      if (!res.ok) {
        toast.info(res.error || '保存失败');
        return;
      }
      toast.info('已保存');
      await onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Field label="名称" value={name} onChange={setName} placeholder="请输入名称" />
      <Pressable style={[styles.primaryBtn, busy && styles.btnDisabled]} onPress={() => void submit()}>
        {busy ? <ActivityIndicator color={w.onPine} /> : <Text style={styles.primaryBtnText}>保存</Text>}
      </Pressable>
    </View>
  );
}

function OptionForm({
  editor,
  busy,
  setBusy,
  onClose,
  onSaved,
}: {
  editor: Extract<WardrobeEditor, { type: 'option' }>;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  const [value, setValue] = useState('');

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await createWardrobeOption({
        kind: editor.kind,
        value,
        closet_id: editor.closetId,
      });
      if (!res.ok) {
        toast.info(res.error || '保存失败');
        return;
      }
      toast.info('词条已添加');
      await onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Field label="词条" value={value} onChange={setValue} placeholder="例如：雾蓝 / COS / 春" />
      <Pressable style={[styles.primaryBtn, busy && styles.btnDisabled]} onPress={() => void submit()}>
        {busy ? <ActivityIndicator color={w.onPine} /> : <Text style={styles.primaryBtnText}>添加</Text>}
      </Pressable>
    </View>
  );
}

function BodyForm({
  editor,
  busy,
  setBusy,
  onClose,
  onSaved,
}: {
  editor: Extract<WardrobeEditor, { type: 'body' }>;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  const p = editor.profile;
  const [height, setHeight] = useState(p.height_cm != null ? String(p.height_cm) : '');
  const [weight, setWeight] = useState(p.weight_kg != null ? String(p.weight_kg) : '');
  const [shoulder, setShoulder] = useState(p.shoulder_cm != null ? String(p.shoulder_cm) : '');
  const [bust, setBust] = useState(p.bust_cm != null ? String(p.bust_cm) : '');
  const [waist, setWaist] = useState(p.waist_cm != null ? String(p.waist_cm) : '');
  const [hip, setHip] = useState(p.hip_cm != null ? String(p.hip_cm) : '');
  const [inseam, setInseam] = useState(p.inseam_cm != null ? String(p.inseam_cm) : '');
  const [foot, setFoot] = useState(p.foot_mm != null ? String(p.foot_mm) : '');
  const [sizeTop, setSizeTop] = useState(p.size_top ?? '');
  const [sizeBottom, setSizeBottom] = useState(p.size_bottom ?? '');
  const [sizeShoe, setSizeShoe] = useState(p.size_shoe ?? '');

  const num = (s: string) => {
    const t = s.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await saveWardrobeBodyProfile({
        closet_id: editor.closetId,
        height_cm: num(height),
        weight_kg: num(weight),
        shoulder_cm: num(shoulder),
        bust_cm: num(bust),
        waist_cm: num(waist),
        hip_cm: num(hip),
        inseam_cm: num(inseam),
        foot_mm: num(foot),
        size_top: sizeTop.trim() || null,
        size_bottom: sizeBottom.trim() || null,
        size_shoe: sizeShoe.trim() || null,
      });
      if (!res.ok) {
        toast.info(res.error || '保存失败');
        return;
      }
      toast.info('身材数据已保存');
      await onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Field label="身高 cm" value={height} onChange={setHeight} keyboardType="decimal-pad" />
      <Field label="体重 kg" value={weight} onChange={setWeight} keyboardType="decimal-pad" />
      <Field label="肩宽 cm" value={shoulder} onChange={setShoulder} keyboardType="decimal-pad" />
      <Field label="胸围 cm" value={bust} onChange={setBust} keyboardType="decimal-pad" />
      <Field label="腰围 cm" value={waist} onChange={setWaist} keyboardType="decimal-pad" />
      <Field label="臀围 cm" value={hip} onChange={setHip} keyboardType="decimal-pad" />
      <Field label="腿长 cm" value={inseam} onChange={setInseam} keyboardType="decimal-pad" />
      <Field label="脚长 mm" value={foot} onChange={setFoot} keyboardType="decimal-pad" />
      <Field label="上装尺码" value={sizeTop} onChange={setSizeTop} placeholder="如 M" />
      <Field label="下装尺码" value={sizeBottom} onChange={setSizeBottom} placeholder="如 27" />
      <Field label="鞋码" value={sizeShoe} onChange={setSizeShoe} placeholder="如 38" />
      <Pressable style={[styles.primaryBtn, busy && styles.btnDisabled]} onPress={() => void submit()}>
        {busy ? <ActivityIndicator color={w.onPine} /> : <Text style={styles.primaryBtnText}>保存</Text>}
      </Pressable>
    </View>
  );
}

function DeleteForm({
  editor,
  busy,
  setBusy,
  onClose,
  onSaved,
}: {
  editor: Extract<WardrobeEditor, { type: 'confirm-delete' }>;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let res;
      switch (editor.target) {
        case 'item':
          res = await deleteWardrobeItem(editor.id);
          break;
        case 'outfit':
          res = await deleteWardrobeOutfit(editor.id);
          break;
        case 'category':
          res = await deleteWardrobeCategory(editor.id);
          break;
        case 'occasion':
          res = await deleteWardrobeOccasion(editor.id);
          break;
        case 'closet':
          res = await deleteWardrobeCloset(editor.id);
          break;
        case 'option':
          res = await deleteWardrobeOption(editor.id);
          break;
      }
      if (!res.ok) {
        toast.info(res.error || '删除失败');
        return;
      }
      toast.info('已删除');
      await onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.deleteBody}>
      <Text style={styles.warnText}>确定删除「{editor.label}」？此操作会同步到云端。</Text>
      <Pressable style={[styles.dangerBtn, busy && styles.btnDisabled]} onPress={() => void submit()}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.dangerBtnText}>确认删除</Text>}
      </Pressable>
      <Pressable style={styles.ghostBtn} onPress={onClose}>
        <Text style={styles.ghostBtnText}>取消</Text>
      </Pressable>
    </View>
  );
}

export async function switchDefaultCloset(id: string): Promise<{ ok: boolean; error?: string }> {
  return setDefaultWardrobeCloset(id);
}

function createStyles(w: WardrobePalette) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: w.screenMid,
      paddingHorizontal: 16,
    },
    itemRoot: {
      flex: 1,
      backgroundColor: w.screenMid,
    },
    itemShell: { flex: 1 },
    itemHead: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingBottom: 8,
      gap: 8,
    },
    itemHeadBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: w.line,
      backgroundColor: w.glass,
      alignItems: 'center',
      justifyContent: 'center',
    },
    itemHeadTitle: {
      flex: 1,
      textAlign: 'center',
      fontFamily: wardrobeFonts.serif,
      fontSize: 18,
      color: w.pine,
    },
    itemSaveBtn: {
      minWidth: 64,
      height: 34,
      paddingHorizontal: 14,
      borderRadius: 999,
      backgroundColor: w.pineSolid,
      alignItems: 'center',
      justifyContent: 'center',
    },
    itemSaveText: {
      fontFamily: wardrobeFonts.sansBold,
      fontSize: 13,
      color: w.onPine,
    },
    itemBodyContent: {
      paddingHorizontal: 14,
      paddingBottom: 36,
      gap: 12,
    },
    heroCard: {
      height: 220,
      borderRadius: 18,
      overflow: 'hidden',
      backgroundColor: w.card,
      borderWidth: 1,
      borderColor: w.line,
    },
    heroCardCutout: {
      backgroundColor: 'transparent',
    },
    heroChecker: {
      ...StyleSheet.absoluteFillObject,
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    heroCheckerCell: {
      width: '12.5%',
      height: '12.5%',
    },
    heroImage: { width: '100%', height: '100%' },
    heroEmpty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: w.paper2,
    },
    heroEmptyText: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 13,
      color: w.muted,
    },
    heroGalleryBtn: {
      position: 'absolute',
      right: 12,
      bottom: 12,
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: w.glassStrong,
      borderWidth: 1,
      borderColor: w.glassBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    aiFillRow: {
      marginTop: 10,
      marginBottom: 4,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    aiFillBtn: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: w.pine,
      backgroundColor: w.paper2,
      minWidth: 108,
      alignItems: 'center',
    },
    aiFillBtnText: {
      fontFamily: wardrobeFonts.sansSemiBold,
      fontSize: 13,
      color: w.pine,
    },
    oneLinerBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(20,28,26,0.42)',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    oneLinerCard: {
      backgroundColor: w.paper,
      borderRadius: 18,
      padding: 16,
      borderWidth: 1,
      borderColor: w.line,
      gap: 8,
    },
    oneLinerTitle: {
      fontFamily: wardrobeFonts.sansSemiBold,
      fontSize: 17,
      color: w.ink,
    },
    oneLinerSub: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 12,
      color: w.muted,
      marginBottom: 4,
    },
    oneLinerInput: {
      minHeight: 88,
      borderWidth: 1,
      borderColor: w.line,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      color: w.ink,
      textAlignVertical: 'top',
      backgroundColor: w.card,
    },
    oneLinerActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 10,
      marginTop: 4,
    },
    oneLinerGhost: {
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    oneLinerGhostText: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      color: w.muted,
    },
    oneLinerPrimary: {
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderRadius: 999,
      backgroundColor: w.pine,
      minWidth: 88,
      alignItems: 'center',
    },
    oneLinerPrimaryText: {
      fontFamily: wardrobeFonts.sansSemiBold,
      fontSize: 14,
      color: w.onPine,
    },
    heroBusyMask: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: 'rgba(247,245,236,0.72)',
    },
    heroBusyText: {
      fontFamily: wardrobeFonts.sansBold,
      fontSize: 12,
      color: w.pine,
    },
    heroCutoutBadge: {
      position: 'absolute',
      left: 12,
      top: 12,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: w.glassStrong,
      borderWidth: 1,
      borderColor: w.glassBorder,
    },
    heroCutoutBadgeText: {
      fontFamily: wardrobeFonts.sansBold,
      fontSize: 10,
      color: w.pine,
      letterSpacing: wardrobeEm(0.04, 10),
    },
    formGroup: {
      borderRadius: 16,
      backgroundColor: w.card,
      borderWidth: 1,
      borderColor: w.line,
      overflow: 'hidden',
    },
    formRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 48,
      paddingHorizontal: 14,
      gap: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: w.line,
    },
    formRowLast: { borderBottomWidth: 0 },
    rowLabel: {
      width: 78,
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      color: w.ink,
    },
    rowTrailing: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
      minWidth: 0,
    },
    rowInput: {
      flex: 1,
      textAlign: 'right',
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      color: w.ink,
      paddingVertical: 10,
      minWidth: 0,
    },
    rowValue: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      color: w.ink,
      textAlign: 'right',
    },
    rowPlaceholder: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      color: w.muted2,
      textAlign: 'right',
    },
    seasonPill: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: w.paper2,
      borderWidth: 1,
      borderColor: w.line,
    },
    seasonPillText: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 12,
      color: w.ink2,
    },
    colorDot: {
      width: 16,
      height: 16,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: w.line2,
    },
    inlinePicker: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      paddingHorizontal: 14,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: w.line,
    },
    inlineEmpty: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 12,
      color: w.muted,
      paddingVertical: 4,
    },
    chipColorDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: w.line2,
    },
    dateBackdrop: {
      flex: 1,
      backgroundColor: w.dim,
      justifyContent: 'flex-end',
    },
    dateDismiss: {
      flex: 1,
    },
    dateSheet: {
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      backgroundColor: w.screenMid,
      borderTopWidth: 1,
      borderColor: w.line,
      paddingHorizontal: 18,
      paddingTop: 10,
      shadowColor: w.shadow,
      shadowOpacity: 0.18,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: -8 },
      elevation: 16,
    },
    dateHandle: {
      alignSelf: 'center',
      width: 42,
      height: 4,
      borderRadius: 999,
      backgroundColor: w.line2,
      marginBottom: 12,
    },
    dateHead: {
      alignItems: 'center',
      marginBottom: 14,
      gap: 4,
    },
    dateKicker: {
      fontFamily: wardrobeFonts.mono,
      fontSize: 10,
      color: w.muted,
      letterSpacing: wardrobeEm(0.14, 10),
    },
    dateTitle: {
      fontFamily: wardrobeFonts.serif,
      fontSize: 20,
      color: w.pine,
    },
    dateSelected: {
      flex: 1,
      textAlign: 'center',
      fontFamily: wardrobeFonts.monoMedium,
      fontSize: 16,
      color: w.amber,
      paddingHorizontal: 8,
    },
    dateMonthBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
      paddingHorizontal: 2,
      gap: 8,
    },
    dateNavBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: w.line,
      backgroundColor: w.glass,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dateNavFlip: {
      transform: [{ rotate: '180deg' }],
    },
    dateWeekRow: {
      flexDirection: 'row',
      marginBottom: 4,
    },
    dateWeekLabel: {
      flex: 1,
      textAlign: 'center',
      fontFamily: wardrobeFonts.sans,
      fontSize: 11,
      color: w.muted,
    },
    dateGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    dateCell: {
      width: '14.2857%',
      aspectRatio: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 2,
    },
    dateDay: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dateDayToday: {
      borderWidth: 1,
      borderColor: w.pine,
      backgroundColor: w.pineWash,
    },
    dateDayOn: {
      backgroundColor: w.pineSolid,
    },
    dateDayText: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      color: w.ink2,
    },
    dateDayTextToday: {
      color: w.pine,
      fontFamily: wardrobeFonts.sansSemiBold,
    },
    dateDayTextOn: {
      color: w.onPine,
      fontFamily: wardrobeFonts.sansSemiBold,
    },
    dateQuickRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 8,
      marginBottom: 4,
    },
    dateQuick: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: w.line,
      backgroundColor: w.card,
    },
    dateQuickText: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 12,
      color: w.ink2,
    },
    dateActions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 10,
    },
    dateGhost: {
      flex: 1,
      height: 46,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: w.line,
      backgroundColor: w.glass,
    },
    dateGhostText: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      color: w.ink2,
    },
    dateConfirm: {
      flex: 1,
      height: 46,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: w.pineSolid,
    },
    dateConfirmText: {
      fontFamily: wardrobeFonts.sansBold,
      fontSize: 14,
      color: w.onPine,
    },
    noteHead: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      color: w.ink,
      paddingHorizontal: 14,
      paddingTop: 14,
      paddingBottom: 8,
    },
    noteBody: {
      paddingHorizontal: 14,
      paddingBottom: 14,
      gap: 10,
    },
    noteAdd: {
      width: 64,
      height: 64,
      borderRadius: 12,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: w.line2,
      backgroundColor: w.paper2,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    noteAddImg: { width: '100%', height: '100%' },
    noteInput: {
      minHeight: 72,
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      lineHeight: 22,
      color: w.ink,
      textAlignVertical: 'top',
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    title: {
      fontFamily: wardrobeFonts.serif,
      fontSize: 22,
      color: w.pine,
    },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: w.line,
      backgroundColor: w.glass,
      alignItems: 'center',
      justifyContent: 'center',
    },
    body: { flex: 1 },
    bodyContent: { paddingBottom: 40, gap: 10 },
    field: { marginBottom: 10 },
    fieldLabel: {
      fontFamily: wardrobeFonts.sansBold,
      fontSize: 11,
      color: w.muted,
      letterSpacing: wardrobeEm(0.06, 11),
      marginBottom: 6,
    },
    input: {
      borderWidth: 1,
      borderColor: w.line,
      backgroundColor: w.card,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 11,
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      color: w.ink,
    },
    inputMulti: { minHeight: 72, textAlignVertical: 'top' },
    chipRow: { gap: 6, paddingVertical: 2 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: w.line,
      backgroundColor: w.glass,
    },
    chipOn: { backgroundColor: w.pineSolid, borderColor: w.pineSolid },
    chipText: { fontFamily: wardrobeFonts.sans, fontSize: 12, color: w.ink3 },
    chipTextOn: { color: w.onPine },
    itemPickList: { gap: 6, marginTop: 4, marginBottom: 12 },
    itemPick: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 10,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: w.line,
      backgroundColor: w.card,
    },
    itemPickOn: { borderColor: w.pine, backgroundColor: w.pineWash },
    itemPickCopy: { flex: 1 },
    itemPickTitle: { fontFamily: wardrobeFonts.sansBold, fontSize: 13, color: w.ink },
    itemPickNote: { fontFamily: wardrobeFonts.sans, fontSize: 11, color: w.muted, marginTop: 2 },
    radio: {
      width: 16,
      height: 16,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: w.line2,
    },
    primaryBtn: {
      marginTop: 8,
      height: 46,
      borderRadius: 999,
      backgroundColor: w.pineSolid,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryBtnText: {
      fontFamily: wardrobeFonts.sansBold,
      fontSize: 14,
      color: w.onPine,
    },
    dangerBtn: {
      marginTop: 4,
      height: 46,
      borderRadius: 999,
      backgroundColor: '#B42318',
      alignItems: 'center',
      justifyContent: 'center',
    },
    dangerBtnText: {
      fontFamily: wardrobeFonts.sansBold,
      fontSize: 14,
      color: '#fff',
    },
    ghostBtn: {
      marginTop: 4,
      height: 42,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ghostBtnText: { fontFamily: wardrobeFonts.sans, fontSize: 13, color: w.muted },
    btnDisabled: { opacity: 0.55 },
    warnText: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      lineHeight: 22,
      color: w.ink2,
      marginBottom: 14,
      textAlign: 'center',
    },
    deleteBackdrop: {
      flex: 1,
      backgroundColor: w.dim,
      justifyContent: 'flex-end',
    },
    deleteDismiss: {
      flex: 1,
    },
    deleteSheet: {
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      backgroundColor: w.screenMid,
      borderTopWidth: 1,
      borderColor: w.line,
      paddingHorizontal: 18,
      paddingTop: 10,
    },
    deleteHandle: {
      alignSelf: 'center',
      width: 42,
      height: 4,
      borderRadius: 999,
      backgroundColor: w.line2,
      marginBottom: 12,
    },
    deleteKicker: {
      textAlign: 'center',
      fontFamily: wardrobeFonts.mono,
      fontSize: 10,
      color: w.muted,
      letterSpacing: wardrobeEm(0.14, 10),
      marginBottom: 4,
    },
    deleteTitle: {
      textAlign: 'center',
      fontFamily: wardrobeFonts.serif,
      fontSize: 20,
      color: w.pine,
      marginBottom: 12,
    },
    deleteBody: {
      gap: 2,
    },
  });
}
