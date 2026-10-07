// Public Paddle.js configuration only. API keys and webhook secrets never belong here.
export function publicPaddleConfig(env) {
  if (env.EXPO_PUBLIC_PADDLE_CHECKOUT_ENABLED !== 'true') return { enabled: false };
  const environment = env.EXPO_PUBLIC_PADDLE_ENV;
  const token = env.EXPO_PUBLIC_PADDLE_CLIENT_TOKEN;
  const prefix = environment === 'sandbox' ? 'test_' : environment === 'live' ? 'live_' : null;
  if (!prefix || typeof token !== 'string' || !new RegExp(`^${prefix}[a-zA-Z0-9]+$`).test(token)) {
    throw new Error(
      'Enabled Paddle checkout requires a matching environment and public client token'
    );
  }
  return { enabled: true, environment, token };
}

export function publicPaddleScript(env) {
  return `window.NAUTICAL_PADDLE = ${JSON.stringify(publicPaddleConfig(env))};\n`;
}
