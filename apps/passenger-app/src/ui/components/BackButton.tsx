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
 * Compact floating back button with fallback route when there is no stack history.
 */
export function BackButton({ fallbackRoute = '/home', style, label }: BackButtonProps) {
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
      style={[styles.button, { top: Math.max(insets.top + 10, 16) }, style]}
      hitSlop={10}
    >
      <Text style={styles.icon}>{'<'}</Text>
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    left: 14,
    zIndex: 1400,
    minWidth: 40,
    height: 40,
    borderRadius: 999,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(203, 213, 225, 0.25)',
    shadowColor: '#020617',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  icon: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '900',
    marginTop: -1,
  },
  label: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
});
