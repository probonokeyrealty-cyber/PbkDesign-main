/**
 * PBK COMMAND CENTER — REACT COMPONENT LIBRARY
 * ==============================================
 * Import these components instead of shadcn/ui defaults.
 * Each component uses PBK CSS classes from pbk-components.css.
 *
 * Prerequisites:
 *   1. pbk-tokens.css imported in your global styles
 *   2. pbk-components.css imported in your global styles
 *   3. Google Fonts loaded (Fraunces, Geist, JetBrains Mono)
 *
 * Usage:
 *   import { PbkButton, PbkStatusChip, PbkScorePill } from '@/components/pbk';
 */

import React, {
  forwardRef,
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
} from 'react';

// ============================================================
// BUTTON
// ============================================================
type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'success' | 'sky-gradient';

interface PbkButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'default' | 'sm';
  children: ReactNode;
}

export const PbkButton = forwardRef<HTMLButtonElement, PbkButtonProps>(
  ({ variant = 'ghost', size = 'default', className = '', children, ...props }, ref) => {
    const variantClass = variant === 'sky-gradient' ? 'pbk-btn-sky-gradient' : `pbk-btn-${variant}`;
    const sizeClass = size === 'sm' ? 'pbk-btn-sm' : '';
    return (
      <button
        ref={ref}
        type="button"
        className={`pbk-btn ${variantClass} ${sizeClass} ${className}`.trim()}
        {...props}
      >
        {children}
      </button>
    );
  }
);
PbkButton.displayName = 'PbkButton';

// ============================================================
// STATUS CHIP
// ============================================================
type StatusVariant =
  | 'new'
  | 'negotiating'
  | 'neg'
  | 'sent'
  | 'won'
  | 'signed'
  | 'cold'
  | 'live'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'testing';

interface PbkStatusChipProps {
  status: StatusVariant;
  children: ReactNode;
  className?: string;
}

export function PbkStatusChip({ status, children, className = '' }: PbkStatusChipProps) {
  return <span className={`pbk-status pbk-status-${status} ${className}`.trim()}>{children}</span>;
}

// ============================================================
// SCORE PILL
// ============================================================
interface PbkScorePillProps {
  score: number;
  className?: string;
}

function getScoreBucket(score: number): string {
  if (score >= 80) return 'hot';
  if (score >= 60) return 'warm';
  if (score >= 40) return 'cool';
  return 'cold';
}

export function PbkScorePill({ score, className = '' }: PbkScorePillProps) {
  const bucket = getScoreBucket(score);
  return <span className={`pbk-score pbk-score-${bucket} ${className}`.trim()}>{score}</span>;
}

// ============================================================
// LEAD TAG
// ============================================================
type TagVariant = 'default' | 'probate' | 'absentee' | 'vacant' | 'prefc' | 'hot';

interface PbkTagProps {
  variant?: TagVariant;
  children: ReactNode;
  className?: string;
}

export function PbkTag({ variant = 'default', children, className = '' }: PbkTagProps) {
  const variantClass = variant === 'default' ? '' : `pbk-tag-${variant}`;
  return <span className={`pbk-tag ${variantClass} ${className}`.trim()}>{children}</span>;
}

// ============================================================
// PAGE STATUS PILL
// ============================================================
type PageStatusVariant = 'production' | 'partial' | 'concept';

interface PbkPageStatusProps {
  status: PageStatusVariant;
  children: ReactNode;
  className?: string;
}

export function PbkPageStatus({ status, children, className = '' }: PbkPageStatusProps) {
  return (
    <span className={`pbk-page-status pbk-page-status-${status} ${className}`.trim()}>
      {children}
    </span>
  );
}

// ============================================================
// DEMO TAG
// ============================================================
interface PbkDemoTagProps {
  caption?: string;
}

export function PbkDemoTag({ caption }: PbkDemoTagProps) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
      <span className="pbk-demo-tag">Demo</span>
      {caption && (
        <span className="pbk-mono-data" style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>
          {caption}
        </span>
      )}
    </span>
  );
}

// ============================================================
// AVATAR
// ============================================================
type AvatarColor = 'default' | 'magenta' | 'lime' | 'amber';
type AvatarSize = 'sm' | 'default' | 'lg';

interface PbkAvatarProps {
  initial: string;
  color?: AvatarColor;
  size?: AvatarSize;
  className?: string;
}

export function PbkAvatar({
  initial,
  color = 'default',
  size = 'default',
  className = '',
}: PbkAvatarProps) {
  const colorClass = color === 'default' ? '' : `pbk-avatar-${color}`;
  const sizeClass = size === 'default' ? '' : `pbk-avatar-${size}`;
  return (
    <div className={`pbk-avatar ${colorClass} ${sizeClass} ${className}`.trim()}>{initial}</div>
  );
}

// ============================================================
// CHIP BUTTON (filter tabs)
// ============================================================
interface PbkChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  children: ReactNode;
}

export function PbkChip({ active = false, children, className = '', ...props }: PbkChipProps) {
  return (
    <button className={`pbk-chip ${active ? 'active' : ''} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

// ============================================================
// INPUT
// ============================================================
interface PbkInputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  success?: boolean;
}

export const PbkInput = forwardRef<HTMLInputElement, PbkInputProps>(
  ({ error, success, className = '', ...props }, ref) => {
    const stateClass = error ? 'pbk-input-error' : success ? 'pbk-input-success' : '';
    return <input ref={ref} className={`pbk-input ${stateClass} ${className}`.trim()} {...props} />;
  }
);
PbkInput.displayName = 'PbkInput';

// ============================================================
// FIELD (label + input wrapper)
// ============================================================
interface PbkFieldProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  help?: string;
  error?: string;
  children: ReactNode;
}

export function PbkField({ label, htmlFor, required, help, error, children }: PbkFieldProps) {
  return (
    <div className="pbk-field">
      <label className={`pbk-label ${required ? 'pbk-label-required' : ''}`} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error && <div className="pbk-error-msg">{error}</div>}
      {!error && help && <div className="pbk-help">{help}</div>}
    </div>
  );
}

// ============================================================
// TOGGLE
// ============================================================
interface PbkToggleProps {
  on: boolean;
  onChange: (on: boolean) => void;
  className?: string;
}

export function PbkToggle({ on, onChange, className = '' }: PbkToggleProps) {
  return (
    <div
      className={`pbk-toggle ${on ? 'on' : ''} ${className}`.trim()}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onChange(!on);
        }
      }}
    />
  );
}

// ============================================================
// PANEL
// ============================================================
interface PbkPanelProps {
  elevated?: boolean;
  priority?: 'high' | 'live' | 'money' | 'low';
  children: ReactNode;
  className?: string;
}

export function PbkPanel({ elevated, priority, children, className = '' }: PbkPanelProps) {
  const base = elevated ? 'pbk-panel-elevated' : 'pbk-panel';
  const priorityClass = priority ? `pbk-priority-${priority}` : '';
  return <div className={`${base} ${priorityClass} ${className}`.trim()}>{children}</div>;
}

// ============================================================
// TOAST
// ============================================================
type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface PbkToastProps {
  variant: ToastVariant;
  title: string;
  description?: string;
}

const TOAST_ICONS: Record<ToastVariant, string> = {
  success: '✓',
  error: '✕',
  warning: '!',
  info: 'i',
};

export function PbkToast({ variant, title, description }: PbkToastProps) {
  return (
    <div className={`pbk-toast pbk-toast-${variant}`}>
      <div className="pbk-toast-icon">{TOAST_ICONS[variant]}</div>
      <div>
        <div className="pbk-toast-title">{title}</div>
        {description && <div className="pbk-toast-desc">{description}</div>}
      </div>
    </div>
  );
}

// ============================================================
// PAGE HEAD
// ============================================================
interface PbkPageHeadProps {
  eyebrow: string;
  title: ReactNode;
  description?: string;
  status?: PageStatusVariant;
  statusLabel?: string;
  actions?: ReactNode;
}

export function PbkPageHead({
  eyebrow,
  title,
  description,
  status,
  statusLabel,
  actions,
}: PbkPageHeadProps) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 'var(--s-4)',
        padding: 'var(--s-5) var(--s-6)',
      }}
    >
      <div style={{ maxWidth: '640px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <span className="pbk-eyebrow">{eyebrow}</span>
          {status && <PbkPageStatus status={status}>{statusLabel || status}</PbkPageStatus>}
        </div>
        <h2 className="pbk-display pbk-h2" style={{ margin: '0 0 4px' }}>
          {title}
        </h2>
        {description && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: 0 }}>
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div style={{ display: 'flex', gap: 'var(--s-2)', flexShrink: 0 }}>{actions}</div>
      )}
    </div>
  );
}

// ============================================================
// EMPTY STATE
// ============================================================
interface PbkEmptyProps {
  variant?: 'ok' | 'idle' | 'default';
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function PbkEmpty({ variant = 'default', icon, title, description, action }: PbkEmptyProps) {
  const variantClass = variant === 'default' ? '' : `pbk-empty-${variant}`;
  return (
    <div className={`pbk-empty ${variantClass}`.trim()}>
      <div className="pbk-empty-icon">{icon || '◯'}</div>
      <div className="pbk-empty-title">{title}</div>
      {description && <div className="pbk-empty-sub">{description}</div>}
      {action}
    </div>
  );
}

// ============================================================
// SKELETON
// ============================================================
interface PbkSkeletonProps {
  variant?: 'text' | 'title' | 'card';
  className?: string;
  style?: React.CSSProperties;
}

export function PbkSkeleton({ variant = 'text', className = '', style }: PbkSkeletonProps) {
  const variantClass = `pbk-skeleton-${variant}`;
  return <div className={`pbk-skeleton ${variantClass} ${className}`.trim()} style={style} />;
}

// ============================================================
// ERROR BANNER
// ============================================================
interface PbkErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

export function PbkErrorBanner({ message, onRetry }: PbkErrorBannerProps) {
  return (
    <div className="pbk-error-banner">
      <span className="pbk-error-banner-text">{message}</span>
      {onRetry && (
        <PbkButton variant="ghost" size="sm" onClick={onRetry}>
          Retry
        </PbkButton>
      )}
    </div>
  );
}

// ============================================================
// PULSE DOT
// ============================================================
type PulseDotColor = 'default' | 'sky' | 'lime' | 'amber';

interface PbkPulseDotProps {
  color?: PulseDotColor;
  className?: string;
}

export function PbkPulseDot({ color = 'default', className = '' }: PbkPulseDotProps) {
  const colorClass = color === 'default' ? '' : `pbk-pulse-dot-${color}`;
  return <span className={`pbk-pulse-dot ${colorClass} ${className}`.trim()} />;
}

// ============================================================
// DATA SOURCE CAPTION
// ============================================================
interface PbkDataSourceProps {
  endpoint: string;
  status: 'ships' | 'needs-wiring';
  note?: string;
}

export function PbkDataSource({ endpoint, status, note }: PbkDataSourceProps) {
  return (
    <div className="pbk-data-source">
      <span className="ds-tag">source</span> <code>{endpoint}</code>
      <span className={`ds-status ${status === 'needs-wiring' ? 'needs' : ''}`.trim()}>
        {status === 'ships' ? 'ships' : 'needs wiring'}
      </span>
      {note && <span className="ds-note">{note}</span>}
    </div>
  );
}
