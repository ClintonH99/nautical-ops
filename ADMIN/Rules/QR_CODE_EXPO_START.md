# QR Code / Expo Start

## Rule

When the user says **"create me a new QR code to scan"** (or similar phrasing like "new QR code," "generate QR code," "start Expo for QR code"), they mean:

**Start the Expo dev server so a fresh QR code appears for scanning in Expo Go.**

## Action

Run:

```
cd yachy-app
npx expo start
```

For tunnel mode (e.g. phone on a different network, or when LAN doesn't work):

```
cd yachy-app
npx expo start --tunnel
```

The QR code will appear in the terminal. The user can scan it with their phone (Expo Go app or camera) to load the app. The tunnel URL (`.exp.direct`) expires when the server stops—each new session requires a new QR code.

## Scope

Applies whenever the user asks for a new QR code to scan for the Nautical Ops app.
