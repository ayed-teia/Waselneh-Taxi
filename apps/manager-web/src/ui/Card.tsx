import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
}

export function Card({ elevated = false, className = '', ...props }: CardProps) {
  return <div className={`ws-card${elevated ? ' ws-card-elevated' : ''} ${className}`.trim()} {...props} />;
}
