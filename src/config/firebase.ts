/**
 * Firebase Configuration
 * Centralizes Firebase setup using the provided config
 */

// Import the Firebase config from the root firebaseConfig.js
let firebaseWebConfig: any = {};

// Use the Firebase config directly
firebaseWebConfig = {
  projectId: 'cac-api-2d773',
  storageBucket: 'cac-api-2d773.firebasestorage.app',
  authDomain: 'cac-api-2d773.firebaseapp.com',
  messagingSenderId: '873231026544',
  appId: '1:873231026544:web:f37f01de827671926c67b5'
};

/**
 * Firebase Admin Configuration
 * Used for server-side operations (Firestore, Auth, etc.)
 */
export const firebaseAdminConfig = {
  projectId: firebaseWebConfig.projectId || process.env.FIREBASE_PROJECT_ID || 'cac-api-2d773',
  // Extract configuration from firebaseConfigs.js
  storageBucket: firebaseWebConfig.storageBucket || `${firebaseWebConfig.projectId || 'cac-api-2d773'}.appspot.com`,
  messagingSenderId: firebaseWebConfig.messagingSenderId,
  appId: firebaseWebConfig.appId,
  authDomain: firebaseWebConfig.authDomain,
  databaseURL: firebaseWebConfig.databaseURL,
};

/**
 * Initialize Firebase Admin with proper configuration
 */
export async function initializeFirebaseAdmin(): Promise<any> {
  // Guard: only initialize when explicitly enabled
  if (process.env.USE_FIREBASE !== 'true') {
    console.log('Firebase disabled for local development (set USE_FIREBASE=true to enable).');
    return {} as any;
  }

  try {
    const admin = await import('firebase-admin');

    if (!admin.apps.length) {
      if (process.env.FUNCTIONS_EMULATOR || process.env.FIREBASE_CONFIG) {
        admin.initializeApp();
      } else {
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
        if (serviceAccount && serviceAccount.trim() !== '') {
          try {
            admin.initializeApp({
              credential: admin.credential.cert(JSON.parse(serviceAccount)),
              projectId: firebaseAdminConfig.projectId,
              storageBucket: firebaseAdminConfig.storageBucket,
            });
          } catch (error) {
            console.warn('Invalid FIREBASE_SERVICE_ACCOUNT. Falling back to project-only init.');
            admin.initializeApp({ projectId: firebaseAdminConfig.projectId });
          }
        } else {
          admin.initializeApp({ projectId: firebaseAdminConfig.projectId });
        }
      }
      console.log(`Firebase Admin initialized for project: ${firebaseAdminConfig.projectId}`);
    }

    return admin;
  } catch (e) {
    console.warn('firebase-admin not installed/available. Skipping Firebase init.');
    return {} as any;
  }
}

/**
 * Export the configuration for use in other parts of the app
 */
export { firebaseWebConfig };

/**
 * Database URL helper
 */
export const getDatabaseURL = () => {
  return `https://${firebaseAdminConfig.projectId}-default-rtdb.firebaseio.com/`;
};

/**
 * Storage bucket helper
 */
export const getStorageBucket = () => {
  return firebaseAdminConfig.storageBucket || `${firebaseAdminConfig.projectId}.appspot.com`;
};