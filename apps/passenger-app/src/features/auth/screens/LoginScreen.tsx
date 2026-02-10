import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button } from '../../../ui';

interface LoginScreenProps {
  onLogin: () => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Waselneh</Text>
        <Text style={styles.subtitle}>Smart taxi service for West Bank cities</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.description}>
          Book your ride between Nablus, Ramallah, and Jenin with ease.
        </Text>
      </View>

      <View style={styles.footer}>
        <Button title="Sign in with Phone" onPress={onLogin} />
        <Text style={styles.terms}>
          By continuing, you agree to our Terms of Service and Privacy Policy
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    padding: 24,
  },
  header: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#007AFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666666',
    textAlign: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  description: {
    fontSize: 18,
    color: '#333333',
    textAlign: 'center',
    lineHeight: 26,
  },
  footer: {
    paddingBottom: 32,
  },
  terms: {
    fontSize: 12,
    color: '#999999',
    textAlign: 'center',
    marginTop: 16,
  },
});
