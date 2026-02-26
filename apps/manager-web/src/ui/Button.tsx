import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'destructive';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`ws-button ws-button-${variant} ${className}`.trim()}
      disabled={disabled || loading}
      {...props}
    >
      <span className={`ws-button-label${loading ? ' ws-button-label-hidden' : ''}`}>{children}</span>
      {loading ? <span className="ws-button-spinner" aria-hidden="true" /> : null}
    </button>
  );
}
