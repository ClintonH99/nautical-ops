import React, { useEffect, useMemo, useState } from 'react';
import { useThemeColors } from '../hooks/useThemeColors';
import { createPageRefresh, installWebRefresh } from '../utils/installWebRefresh';

export function WebPageRefresh() {
  const colors = useThemeColors();
  const [message, setMessage] = useState('');
  const refresh = useMemo(
    () =>
      createPageRefresh({
        online: () => window.navigator.onLine !== false,
        confirm: (message) => window.confirm(message),
        reload: () => window.location.reload(),
        status: setMessage,
      }),
    []
  );
  useEffect(() => installWebRefresh(refresh, setMessage), [refresh]);
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
      <button
        type="button"
        onClick={refresh}
        aria-label="Refresh page"
        title="Refresh page — asks before discarding unsaved work"
        style={{
          pointerEvents: 'auto',
          cursor: 'pointer',
          background: colors.surface,
          color: colors.textPrimary,
          border: `1px solid ${colors.border}`,
          borderRadius: 22,
          minHeight: 44,
          padding: '8px 14px',
          fontFamily: 'inherit',
          fontSize: 14,
          fontWeight: 600,
          boxShadow: '0 2px 8px #0002',
        }}
      >
        ↻ Refresh
      </button>
    </div>
  );
}
