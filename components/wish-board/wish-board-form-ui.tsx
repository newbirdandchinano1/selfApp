import type { WishBoxPalette, WishBoxShadowSet } from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { WishBoxGradientFill } from '@/components/wish-board/wish-box-gradient-fill';

/** 表单小标题：「字段名 *」+ 右侧辅助说明（设计稿 flabel） */
export function WishFormLabel({
  label,
  required,
  hint,
}: {
  label: string;
  required?: boolean;
  hint?: string;
}) {
  const styles = useWishStyles(makeStyles);
  return (
    <View style={styles.labelRow}>
      <Text style={styles.labelText}>
        {label}
        {required ? <Text style={styles.req}> *</Text> : null}
      </Text>
      {hint ? <Text style={styles.labelHint}>{hint}</Text> : null}
    </View>
  );
}

/** 柿子橙胶囊开关（设计稿 .switch：48 × 29，knob 23，220ms 弹性位移） */
export function WishSwitch({
  on,
  disabled,
  onToggle,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  const { gradients } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const [knob] = React.useState(() => new Animated.Value(on ? 1 : 0));

  React.useEffect(() => {
    Animated.spring(knob, {
      toValue: on ? 1 : 0,
      useNativeDriver: true,
      friction: 7,
      tension: 120,
    }).start();
  }, [on, knob]);

  const translateX = knob.interpolate({ inputRange: [0, 1], outputRange: [3, 22] });

  return (
    <Pressable
      onPress={() => onToggle(!on)}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: Boolean(disabled) }}
      style={[styles.switchTrack, on ? styles.switchTrackOn : styles.switchTrackOff, disabled && { opacity: 0.5 }]}>
      {on ? <WishBoxGradientFill colors={gradients.primary} radius={99} /> : null}
      <Animated.View
        style={[styles.switchKnob, { transform: [{ translateX }] }]}
        pointerEvents="none"
      />
    </Pressable>
  );
}

/** 开关行：图标 + 标题 + 副标题（可含「更换」链接） + 开关（设计稿 .tglrow） */
export function WishToggleRow({
  emoji,
  title,
  subtitle,
  subtitleLink,
  onPressLink,
  on,
  disabled,
  onToggle,
  children,
}: {
  emoji: string;
  title: string;
  subtitle: string;
  subtitleLink?: string;
  onPressLink?: () => void;
  on: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
  children?: React.ReactNode;
}) {
  const styles = useWishStyles(makeStyles);
  return (
    <View style={[styles.tglrow, disabled && { opacity: 0.6 }]}>
      <Pressable
        onPress={() => onToggle(!on)}
        disabled={disabled}
        style={styles.tglLeft}
        accessibilityRole="button"
        accessibilityLabel={title}>
        <Text style={styles.tglTitle}>
          {emoji} {title}
        </Text>
        <View style={styles.tglSubRow}>
          <Text style={styles.tglSub} numberOfLines={2}>
            {subtitle}
          </Text>
          {subtitleLink && onPressLink ? (
            <Pressable
              onPress={onPressLink}
              disabled={disabled}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={subtitleLink}>
              <Text style={styles.tglLink}>{subtitleLink}</Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
      <WishSwitch on={on} disabled={disabled} onToggle={onToggle} />
      {children}
    </View>
  );
}

function makeStyles(c: WishBoxPalette, _shadows: WishBoxShadowSet) {
  return StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 6,
  },
  labelText: {
    fontSize: 13,
    fontWeight: '800',
    color: c.ink,
  },
  req: {
    color: c.pri,
  },
  labelHint: {
    fontSize: 11,
    color: c.muted,
    fontWeight: '600',
  },
  switchTrack: {
    width: 48,
    height: 29,
    borderRadius: 99,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  switchTrackOff: {
    backgroundColor: c.disabledBg,
  },
  switchTrackOn: {
    backgroundColor: c.pri,
  },
  switchKnob: {
    width: 23,
    height: 23,
    borderRadius: 99,
    backgroundColor: c.switchKnob,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  tglrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.card,
    borderWidth: 1.5,
    borderColor: c.line,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 10,
    marginTop: 9,
  },
  tglLeft: {
    flex: 1,
    minWidth: 0,
    paddingRight: 10,
  },
  tglTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: c.ink,
  },
  tglSubRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
    marginTop: 3,
  },
  tglSub: {
    flex: 1,
    fontSize: 11.5,
    color: c.muted,
    lineHeight: 17,
  },
  tglLink: {
    fontSize: 11.5,
    fontWeight: '800',
    color: c.pri,
  },
  });
}
