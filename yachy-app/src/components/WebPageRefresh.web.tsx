import React, { useEffect, useMemo, useState } from 'react';
import { useThemeColors } from '../hooks/useThemeColors';
import { createPageRefresh, installWebRefresh } from '../utils/installWebRefresh';
import { usesPullRefreshOnly } from '../utils/refreshDevice';
import { COLORS } from '../constants/theme';

const TOUCH_FIRST_QUERY = '(hover: none) and (pointer: coarse)';

function isPullOnlyDevice() {
  return usesPullRefreshOnly(
    window.navigator,
    window.matchMedia?.(TOUCH_FIRST_QUERY).matches ?? false
  );
}

export function WebPageRefresh() {
  const colors = useThemeColors();
  const [message, setMessage] = useState('');
  const [pullOnly, setPullOnly] = useState(isPullOnlyDevice);
  const refresh = useMemo(
    () =>
      createPageRefresh({
        online: () => window.navigator.onLine !== false,
        reload: () => window.location.reload(),
        status: setMessage,
      }),
    []
  );
  useEffect(() => {
    const media = window.matchMedia?.(TOUCH_FIRST_QUERY);
    const update = () => setPullOnly(isPullOnlyDevice());
    media?.addEventListener('change', update);
    return () => media?.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (pullOnly) return installWebRefresh(refresh, setMessage);
  }, [pullOnly, refresh]);
  return (
    <div
      data-refresh-ignore="true"
      style={{
        position: 'fixed',
        right: 12,
        bottom: 'calc(82px + env(safe-area-inset-bottom, 0px))',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
        maxWidth: 'calc(100vw - 24px)',
        pointerEvents: 'none',
      }}
    >
      {message ? (
        <div
          role="status"
          style={{
            background: colors.surface,
            color: colors.textPrimary,
            padding: 10,
            borderRadius: 8,
            maxWidth: 300,
            boxShadow: '0 2px 8px #0002',
            fontSize: 14,
          }}
        >
          {message}
        </div>
      ) : null}
      {!pullOnly && (
        <button
          type="button"
          onClick={refresh}
          aria-label="Refresh page"
          title="Refresh page"
          style={{
            pointerEvents: 'auto',
            cursor: 'pointer',
            background: COLORS.primary,
            color: COLORS.white,
            border: 'none',
            borderRadius: 999,
            minHeight: 48,
            padding: '10px 20px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 14,
            fontWeight: 600,
            boxShadow: '0 3px 10px #17255426',
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M20 7v5h-5" />
            <path d="M20 12a8 8 0 1 0-2.4 5.7M20 12a8 8 0 0 0-2.4-5.7" />
          </svg>
          Refresh
        </button>
      )}
    </div>
  );
}
