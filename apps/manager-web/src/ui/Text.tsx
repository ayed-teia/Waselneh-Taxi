import React from 'react';

type TextVariant = 'h1' | 'h2' | 'body' | 'caption';

interface TextProps extends React.HTMLAttributes<HTMLElement> {
  as?: React.ElementType;
  variant?: TextVariant;
  muted?: boolean;
}

export function Text({ as = 'p', variant = 'body', muted = false, className = '', ...props }: TextProps) {
  const Component = as;
  return (
    <Component
      className={`ws-text ws-text-${variant}${muted ? ' ws-text-muted' : ''} ${className}`.trim()}
      {...props}
    />
  );
}
