import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { onAuthStateChanged, type User } from '../src/services/firebase';
import { useAuthStore } from '../src/store';

export default function RootLayout() {
  const { setUser } = useAuthStore();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isMounted = true;
    
    // Using @react-native-firebase - much simpler and more reliable
    const unsubscribe = onAuthStateChanged((user: User | null) => {
      if (isMounted) {
        // Convert native user to compatible format for store
        setUser(user ? {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          emailVerified: user.emailVerified,
          phoneNumber: user.phoneNumber,
          isAnonymous: user.isAnonymous,
        } as any : null);
        setIsReady(true);
        console.log('✓ Auth state changed:', user ? `User ${user.uid}` : 'No user');
      }
    });
    
    return () => {
      isMounted = false;
      unsubscribe();
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
