// 📄 ucolis-backend/services/notifications.js
/**
 * Service de notifications push via Expo Push API.
 * Utilisé pour envoyer des notifications en dehors des sockets (ex: background).
 */
async function sendPushNotification({ expoPushToken, title, body, data = {} }) {
  if (!expoPushToken) return;

  const message = {
    to:    expoPushToken,
    sound: 'default',
    title,
    body,
    data,
    priority: 'high',
  };

  try {
    const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method:  'POST',
      headers: {
        'Accept':       'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });
    return response.json();
  } catch (error) {
    console.warn('Push notification error:', error.message);
  }
}

module.exports = { sendPushNotification };
