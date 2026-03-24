import { db } from '../../config/firebase';
import { User } from '../../shared/types/data';
import { logger } from '../logger/logger';

/**
 * Checks if a Telegram user (by username) has a specific role in Firestore.
 */
export async function hasRole(telegramUsername: string | undefined, role: 'admin' | 'employee'): Promise<boolean> {
    if (!telegramUsername) {
        logger.warn(`Permission check failed: No Telegram username provided.`);
        return false;
    }

    try {
        const usersRef = db.collection('users');
        const querySnapshot = await usersRef.where('telegramUsername', '==', telegramUsername.replace(/^@/, '')).get();

        if (querySnapshot.empty) {
            logger.warn(`Permission check failed: User @${telegramUsername} not found in database.`);
            return false;
        }

        const userData = querySnapshot.docs[0].data() as User;

        // Admin has access to everything
        if (userData.role === 'admin') return true;

        // If checking for employee, and they are employee, return true
        if (role === 'employee' && userData.role === 'employee') return true;

        logger.warn(`Permission denied: User @${telegramUsername} has role '${userData.role}', but '${role}' is required.`);
        return false;
    } catch (error: any) {
        logger.error(`Error in permission check for @${telegramUsername}: ${error.message}`);
        return false;
    }
}

/**
 * Specialized check for admin-only commands.
 */
export async function isAdmin(telegramUsername: string | undefined): Promise<boolean> {
    return hasRole(telegramUsername, 'admin');
}
/**
 * Gets the full user profile from Firestore based on Telegram username.
 */
export async function getUserProfile(telegramUsername: string | undefined): Promise<User | null> {
    if (!telegramUsername) return null;

    try {
        const usersRef = db.collection('users');
        const querySnapshot = await usersRef.where('telegramUsername', '==', telegramUsername.replace(/^@/, '')).get();

        if (querySnapshot.empty) return null;

        return querySnapshot.docs[0].data() as User;
    } catch (error: any) {
        logger.error(`Error fetching profile for @${telegramUsername}: ${error.message}`);
        return null;
    }
}
