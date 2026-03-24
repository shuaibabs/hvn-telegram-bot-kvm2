
import { auth, db } from '../../config/firebase';

export const getUserByTelegramUsername = async (telegramUsername: string) => {
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('telegramUsername', '==', telegramUsername).limit(1).get();
    if (snapshot.empty) {
        return null;
    }
    return snapshot.docs[0].data();
};

export const isAdmin = async (telegramUsername: string) => {
    const user = await getUserByTelegramUsername(telegramUsername);
    return user?.role === 'admin';
};

