import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LoadingState, ScreenContainer } from '@waselneh/ui';
import { onAuthStateChanged, type User } from '../src/services/firebase';
import { useAuthStore } from '../src/store';

export default function RootLayout() {
  const { setUser } = useAuthStore();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onAuthStateChanged((user: User | null) => {
      if (isMounted) {
        setUser(
          user
            ? ({
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL,
                emailVerified: user.emailVerified,
                phoneNumber: user.phoneNumber,
                isAnonymous: user.isAnonymous,
              } as any)
            : null
        );
        setIsReady(true);
        console.log('Auth state changed:', user ? `User ${user.uid}` : 'No user');
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [setUser]);

  if (!isReady) {
    return (
      <ScreenContainer padded={false}>
        <LoadingState title="Initializing passenger app..." />
      </ScreenContainer>
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
