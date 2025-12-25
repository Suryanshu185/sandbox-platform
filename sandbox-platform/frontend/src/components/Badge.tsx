import { ReactNode } from 'react';
import clsx from 'clsx';
import type { SandboxStatus, SandboxPhase } from '../types';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
}

export function Badge({ children, variant = 'default', size = 'sm' }: BadgeProps) {
  const variants = {
    default: 'bg-gray-100 text-gray-800',
    success: 'bg-green-100 text-green-800',
    warning: 'bg-yellow-100 text-yellow-800',
    danger: 'bg-red-100 text-red-800',
    info: 'bg-blue-100 text-blue-800',
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
  };

  return (
    <span className={clsx('inline-flex items-center font-medium rounded-full', variants[variant], sizes[size])}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: SandboxStatus }) {
  const config: Record<SandboxStatus, { variant: BadgeProps['variant']; label: string }> = {
    pending: { variant: 'warning', label: 'Pending' },
    running: { variant: 'success', label: 'Running' },
    stopped: { variant: 'default', label: 'Stopped' },
    error: { variant: 'danger', label: 'Error' },
    expired: { variant: 'danger', label: 'Expired' },
  };

  const { variant, label } = config[status];

  return (
    <Badge variant={variant}>
      <span className={clsx('w-1.5 h-1.5 rounded-full mr-1.5', {
        'bg-yellow-500': variant === 'warning',
        'bg-green-500': variant === 'success',
        'bg-gray-500': variant === 'default',
        'bg-red-500': variant === 'danger',
        'bg-blue-500': variant === 'info',
      })} />
      {label}
    </Badge>
  );
}

export function PhaseBadge({ phase }: { phase: SandboxPhase }) {
  const config: Record<SandboxPhase, { variant: BadgeProps['variant']; label: string }> = {
    creating: { variant: 'info', label: 'Creating' },
    starting: { variant: 'info', label: 'Starting' },
    healthy: { variant: 'success', label: 'Healthy' },
    stopping: { variant: 'warning', label: 'Stopping' },
    stopped: { variant: 'default', label: 'Stopped' },
    failed: { variant: 'danger', label: 'Failed' },
  };

  const { variant, label } = config[phase];

  return <Badge variant={variant}>{label}</Badge>;
}
