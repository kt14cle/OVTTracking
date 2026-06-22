const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

let credential;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    credential = cert(serviceAccount);
  } else {
    const serviceAccount = require('./serviceAccount.json');
    credential = cert(serviceAccount);
  }
} catch (error) {
  console.error('Firebase credential error:', error);
  process.exit(1);
}

initializeApp({ credential });

const db = getFirestore();

module.exports = { db };