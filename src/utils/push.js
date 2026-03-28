const admin = require('firebase-admin');
const path = require('path');

let initialized = false;

function initFirebase() {
  if (initialized) return;

  // Option A: service account JSON file (place at FinCoordAPI/firebase-service-account.json)
  const serviceAccountPath = path.join(__dirname, '../../firebase-service-account.json');
  try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    initialized = true;
  } catch {
    // Option B: GOOGLE_APPLICATION_CREDENTIALS env var or default credentials
    try {
      admin.initializeApp();
      initialized = true;
    } catch {
      console.warn('[push] Firebase Admin not initialized — push notifications disabled');
    }
  }
}

/**
 * Send a push notification to a single FCM token.
 * Silently swallows errors so callers don't need try/catch.
 */
async function sendPush(fcmToken, { title, body, data = {} }) {
  if (!fcmToken) return;
  initFirebase();
  if (!initialized) return;

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data,
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'fincoord-default' },
      },
    });
  } catch (err) {
    // Token may be stale — log but don't crash
    console.warn('[push] Failed to send:', err.message);
  }
}

/**
 * Send to multiple tokens at once.
 */
async function sendMulticast(fcmTokens, payload) {
  const valid = fcmTokens.filter(Boolean);
  if (valid.length === 0) return;
  await Promise.all(valid.map(t => sendPush(t, payload)));
}

module.exports = { sendPush, sendMulticast };
