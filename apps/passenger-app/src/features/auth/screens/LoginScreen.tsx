import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, ScreenContainer, Text } from '@waselneh/ui';

interface LoginScreenProps {
  onLogin: () => void;
  loading?: boolean;
}

export function LoginScreen({ onLogin, loading = false }: LoginScreenProps) {
  return (
    <ScreenContainer style={styles.container}>
      <View style={styles.header}>
        <Text variant="h1" style={styles.title}>
          Waselneh
        </Text>
        <Text muted style={styles.subtitle}>
          Smart taxi service for West Bank cities
        </Text>
      </View>

      <View style={styles.content}>
        <Card elevated>
          <Text style={styles.description}>
            Book your ride between Nablus, Ramallah, and Jenin with ease.
          </Text>
        </Card>
      </View>

      <View style={styles.footer}>
        <Button title="Sign in with Phone" onPress={onLogin} loading={loading} />
        <Text variant="caption" muted style={styles.terms}>
          By continuing, you agree to our Terms of Service and Privacy Policy
        </Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 8,
  },
  header: {
    marginTop: 12,
    gap: 8,
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  description: {
    textAlign: 'center',
  },
  footer: {
    gap: 16,
    paddingBottom: 12,
  },
  terms: {
    textAlign: 'center',
  },
});
