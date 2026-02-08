import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { getFirebaseAuthAsync } from '../src/services/firebase';
import { useAuthStore } from '../src/store';

export default function RootLayout() {
  const { setUser } = useAuthStore();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    
    // Async auth initialization required for React Native
    const initAuth = async () => {
      try {
        const auth = await getFirebaseAuthAsync();
        // Dynamic import to avoid loading auth at module scope
        const { onAuthStateChanged } = await import('firebase/auth');
        
        unsubscribe = onAuthStateChanged(auth, (user) => {
          setUser(user);
          setIsReady(true);
        });
      } catch (error) {
        console.error('Failed to initialize auth:', error);
        setUser(null);
        setIsReady(true);
      }
    };
    
    initAuth();
    
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [setUser]);

  if (!isReady) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
