import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@waselneh/ui';
import { useI18n } from '../../localization';

export function LanguageToggle() {
  const { locale, setLocale, isRTL } = useI18n();

  return (
    <View style={[styles.container, isRTL ? styles.rtl : styles.ltr]}>
      <Pressable
        onPress={() => {
          void setLocale('ar');
        }}
        style={[styles.chip, locale === 'ar' && styles.active]}
      >
        <Text variant="caption" style={[styles.label, locale === 'ar' && styles.activeLabel]}>
          عربي
        </Text>
      </Pressable>
      <Pressable
        onPress={() => {
          void setLocale('en');
        }}
        style={[styles.chip, locale === 'en' && styles.active]}
      >
        <Text variant="caption" style={[styles.label, locale === 'en' && styles.activeLabel]}>
          EN
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 6,
    alignSelf: 'flex-end',
  },
  ltr: {
    direction: 'ltr',
  },
  rtl: {
    direction: 'rtl',
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#F8FAFC',
  },
  active: {
    borderColor: '#1D4ED8',
    backgroundColor: '#DBEAFE',
  },
  label: {
    color: '#334155',
    fontWeight: '700',
  },
  activeLabel: {
    color: '#1D4ED8',
  },
});
