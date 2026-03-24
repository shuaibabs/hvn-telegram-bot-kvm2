import { db, auth } from '../../config/firebase';
import { User } from '../../shared/types/data';
import { userSchema } from '../../shared/utils/validation';
import { logger } from '../../core/logger/logger';

export const addUser = async (userData: User, password?: string) => {
    // Validate data structure
    const validation = userSchema.partial().safeParse(userData);
    if (!validation.success) {
        throw new Error(`Data validation failed: ${validation.error.errors.map(e => e.message).join(', ')}`);
    }

    const usersRef = db.collection('users');

    // 1. Robust email uniqueness check (traversing if necessary, though where() is efficient)
    if (userData.email) {
        const existingEmail = await usersRef.where('email', '==', userData.email.toLowerCase()).get();
        if (!existingEmail.empty) throw new Error('User with this email already exists.');
    }

    if (userData.telegramUsername) {
        const existingTelegram = await usersRef.where('telegramUsername', '==', userData.telegramUsername.replace(/^@/, '')).get();
        if (!existingTelegram.empty) throw new Error('User with this Telegram username already exists.');
    }

    let uid = '';

    // 2. Create user in Firebase Authentication if password is provided
    if (password) {
        try {
            const authUser = await auth.createUser({
                email: userData.email,
                password: password,
                displayName: userData.displayName,
            });
            uid = authUser.uid;
            logger.info(`Firebase Auth user created for ${userData.email} with UID: ${uid}`);
        } catch (error: any) {
            logger.error(`Failed to create Firebase Auth user: ${error.message}`);
            throw new Error(`Auth Error: ${error.message}`);
        }
    }

    // 3. Save to Firestore
    const newUserRef = uid ? usersRef.doc(uid) : usersRef.doc();
    const newUser = {
        ...userData,
        uid: uid || newUserRef.id,
        id: uid || newUserRef.id,
        email: userData.email.toLowerCase(),
    };

    await newUserRef.set(newUser);
    logger.info(`User ${userData.displayName} saved to Firestore.`);
    return newUser;
};

export const deleteUser = async (userId: string) => {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) throw new Error('User not found in database.');

    const userData = userDoc.data() as User;

    // 1. Delete from Firebase Authentication if UID exists
    if (userData.uid) {
        try {
            await auth.deleteUser(userData.uid);
            logger.info(`User ${userData.email} deleted from Firebase Auth.`);
        } catch (error: any) {
            // If user doesn't exist in Auth, just log and continue to delete from Firestore
            if (error.code === 'auth/user-not-found') {
                logger.warn(`User ${userData.email} not found in Firebase Auth during deletion.`);
            } else {
                logger.error(`Failed to delete user from Firebase Auth: ${error.message}`);
                throw new Error(`Auth Deletion Error: ${error.message}`);
            }
        }
    }

    // 2. Delete from Firestore
    await userRef.delete();
    logger.info(`User document ${userId} deleted from Firestore.`);
};

export const getAllUsers = async (): Promise<User[]> => {
    const snapshot = await db.collection('users').get();
    return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as User));
};

export const updateUserTelegramUsername = async (userId: string, telegramUsername: string) => {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) throw new Error('User not found.');

    await userRef.update({ telegramUsername });
};

export const updateUserDisplayName = async (userId: string, displayName: string) => {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) throw new Error('User not found.');

    await userRef.update({ displayName });
};

export const getUserByTelegramUsername = async (telegramUsername: string): Promise<User | null> => {
    const usersRef = db.collection('users');
    const querySnapshot = await usersRef.where('telegramUsername', '==', telegramUsername).get();

    if (querySnapshot.empty) {
        return null;
    }

    // Assuming telegramUsername is unique, return the first found user
    const userDoc = querySnapshot.docs[0];
    return { id: userDoc.id, ...userDoc.data() } as User;
};
