import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Asset } from 'expo-asset';
import { useThemeColors } from '../hooks/useThemeColors';
import { createPageRefresh, installWebRefresh } from '../utils/installWebRefresh';
import { usesPullRefreshOnly } from '../utils/refreshDevice';
import { COLORS } from '../constants/theme';

const TOUCH_FIRST_QUERY = '(hover: none) and (pointer: coarse)';
// Metro needs a static require to bundle the approved logo on web.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BOAT_LOGO = Asset.fromModule(require('../../assets/nautical-ops-vessel-logo.png')).uri;
const BOAT_STATES = new Set(['Pull down to refresh', 'Release to refresh', 'Refreshing…']);

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
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshing = useRef(false);
  const refresh = useMemo(
    () =>
      createPageRefresh({
        online: () => window.navigator.onLine !== false,
        reload: () => window.location.reload(),
        status: (text) => {
          refreshing.current = text === 'Refreshing…';
          setMessage(text);
        },
        scheduleReload: pullOnly
          ? (reload) => {
              // Let the boat paint before navigation replaces this document.
              reloadTimer.current = setTimeout(reload, 200);
            }
          : undefined,
      }),
    [pullOnly]
  );
  useEffect(
    () => () => {
      if (reloadTimer.current !== null) clearTimeout(reloadTimer.current);
    },
    []
  );
  useEffect(() => {
    const media = window.matchMedia?.(TOUCH_FIRST_QUERY);
    const update = () => setPullOnly(isPullOnlyDevice());
    media?.addEventListener('change', update);
    return () => media?.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (pullOnly)
      return installWebRefresh(refresh, (text) => {
        // A second touch must not hide the indicator while navigation is pending.
        if (!refreshing.current) setMessage(text);
      });
  }, [pullOnly, refresh]);
  const showBoat = pullOnly && BOAT_STATES.has(message);
  return (
    <>
      <style>{`
        @keyframes nautical-refresh-rock {
          0%, 100% { transform: rotate(-9deg); }
          50% { transform: rotate(9deg); }
        }
        .nautical-refresh-boat[data-refreshing="true"] {
          animation: nautical-refresh-rock 1.1s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .nautical-refresh-boat[data-refreshing="true"] { animation: none; }
        }
      `}</style>
      {showBoat && (
        <div
          role="status"
          aria-live="polite"
          data-refresh-ignore="true"
          data-refresh-indicator="boat"
          style={{
            position: 'fixed',
            top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
            pointerEvents: 'none',
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: COLORS.white,
            boxShadow: '0 3px 12px #17255426',
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              position: 'absolute',
              width: 1,
              height: 1,
              overflow: 'hidden',
              clipPath: 'inset(50%)',
            }}
          >
            {message}
          </span>
          <div
            className="nautical-refresh-boat"
            data-refreshing={message === 'Refreshing…'}
            aria-hidden="true"
            style={{ width: '100%', height: '100%', position: 'relative' }}
          >
            <img
              src={BOAT_LOGO}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                width: 88,
                height: 88,
                maxWidth: 'none',
                left: -16,
                top: -16,
              }}
            />
          </div>
        </div>
      )}
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
        {message && !BOAT_STATES.has(message) ? (
          <div
            role="status"
            data-refresh-feedback="error"
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
    </>
  );
}
