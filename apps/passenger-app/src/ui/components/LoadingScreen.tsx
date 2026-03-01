import React from 'react';
import { LoadingState, ScreenContainer } from '@waselneh/ui';

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
