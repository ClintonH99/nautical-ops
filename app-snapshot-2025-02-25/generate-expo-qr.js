/**
 * Generate QR code for Expo Go
 * Run: node generate-expo-qr.js
 * Run with custom IP: node generate-expo-qr.js 192.168.0.50
 * Run with custom IP and port: node generate-expo-qr.js 192.168.0.50 8082
 */
const path = require('path');
const { execSync } = require('child_process');

// Get local IP - use arg, or try ipconfig (macOS), or default
let ip = process.argv[2];
if (!ip) {
  try {
    ip = execSync('ipconfig getifaddr en0', { encoding: 'utf8' }).trim();
  } catch (e) {
    ip = '192.168.1.1'; // Replace with your machine's local IP if needed
  }
}

const port = process.argv[3] || '8081';
const expoUrl = `exp://${ip}:${port}`;
console.log('Expo URL:', expoUrl);
console.log('Generate QR at: https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(expoUrl));

// Generate QR code
const QRCode = require('qrcode');
const outPath = path.join(__dirname, 'qr-code-expo.png');
QRCode.toFile(outPath, expoUrl, { width: 300 })
  .then(() => {
    console.log('\nQR code saved to: qr-code-expo.png');
    console.log('Scan with Expo Go app to open your project.');
  })
  .catch((err) => {
    console.error('Error:', err.message);
    console.log('\nOpen this URL in your browser to get a QR code:');
    console.log('https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(expoUrl));
    process.exit(1);
  });
