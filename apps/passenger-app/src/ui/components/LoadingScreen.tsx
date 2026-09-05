import { LoadingState, ScreenContainer } from '@waselneh/ui';
import React from 'react';

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message = 'Loading...' }: LoadingScreenProps) {
  return (
    <ScreenContainer padded={false}>
      <LoadingState title={message} />
    </ScreenContainer>
  );
}
