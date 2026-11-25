import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { Animated, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

export type ToastType = 'ok' | 'err' | 'warn';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  show: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ show: () => {} });

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { colors, isDark } = useTheme();
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, type: ToastType = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev.slice(-2), { id, message, type }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 2600);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 128,
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 20,
        }}
      >
        {items.map((item) => (
          <ToastBubble
            key={item.id}
            item={item}
            bg={isDark ? '#E7EFE9' : colors.ink}
            fg={isDark ? '#14211B' : colors.bg}
            accent={
              item.type === 'err'
                ? colors.danger
                : item.type === 'warn'
                ? colors.amber
                : colors.sage
            }
            icon={
              item.type === 'err'
                ? 'close-circle'
                : item.type === 'warn'
                ? 'alert-circle'
                : 'checkmark-circle'
            }
          />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

function ToastBubble({
  item,
  bg,
  fg,
  accent,
  icon,
}: {
  item: ToastItem;
  bg: string;
  fg: string;
  accent: string;
  icon: any;
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 18,
      bounciness: 8,
    }).start();
  }, [anim]);

  const opacity = anim;
  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
  });
  const scale = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.9, 1],
  });

  return (
    <Animated.View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        backgroundColor: bg,
        paddingHorizontal: 18,
        paddingVertical: 11,
        borderRadius: 999,
        maxWidth: '100%',
        opacity,
        transform: [{ translateY }, { scale }],
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
      }}
    >
      <Ionicons name={icon} size={17} color={accent} />
      <Text style={{ color: fg, fontSize: 13, fontWeight: '600', flexShrink: 1 }}>
        {item.message}
      </Text>
    </Animated.View>
  );
}
