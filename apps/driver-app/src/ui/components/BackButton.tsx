import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface BackButtonProps {
  fallbackRoute?: string;
  style?: StyleProp<ViewStyle>;
  label?: string;
}

/**
 * Floating back button with safe fallback route when stack history is empty.
 */
export function BackButton({ fallbackRoute = '/home', style, label = 'Back' }: BackButtonProps) {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const handleBack = () => {
    if ((navigation as any).canGoBack?.()) {
      (navigation as any).goBack();
      return;
    }

    router.replace(fallbackRoute as any);
  };

  return (
    <Pressable
      onPress={handleBack}
      style={[styles.button, { top: Math.max(insets.top + 8, 14) }, style]}
      hitSlop={10}
    >
      <Text style={styles.icon}>{'<'}</Text>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    left: 14,
    zIndex: 1000,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.86)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.45)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  icon: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '800',
  },
  label: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
});
