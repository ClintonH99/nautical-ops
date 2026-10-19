const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // pdf-lib uses tslib 1.x. Its exports/import wrapper expects a default
  // export that Metro does not provide, crashing only when PDF export loads.
  // Use tslib's legacy module entry on web; leave other packages/native alone.
  const resolverContext =
    platform === 'web' && moduleName === 'tslib'
      ? { ...context, unstable_enablePackageExports: false }
      : context;
  return (resolveRequest || context.resolveRequest)(resolverContext, moduleName, platform);
};

module.exports = config;
