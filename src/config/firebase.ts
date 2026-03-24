import admin from 'firebase-admin';
import { env } from './env';
import { logger } from '../core/logger/logger';

const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);

admin.initializeApp({
  credential: admin.credential.cert(
    serviceAccount as admin.ServiceAccount
  )
  // databaseURL: process.env.FIREBASE_DATABASE_URL,
});

logger.info('Firebase Admin SDK initialized successfully.');

export const db = admin.firestore();
export const auth = admin.auth();
