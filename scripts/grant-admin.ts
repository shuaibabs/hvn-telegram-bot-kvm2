
import { db } from '../src/config/firebase';

async function grantAdmin(telegramUsername: string) {
    try {
        const usersRef = db.collection('users');
        // Check if user already exists
        const query = await usersRef.where('telegramUsername', '==', telegramUsername).get();

        if (!query.empty) {
            console.log(`User ${telegramUsername} already exists.`);
            return;
        }

        // Add new admin user
        const newUser = {
            telegramUsername: telegramUsername,
            role: 'admin',
            displayName: 'Admin User',
        };

        await usersRef.add(newUser);
        console.log(`Successfully added ${telegramUsername} as an authorized admin!`);
    } catch (error) {
        console.error('Error adding user:', error);
    } finally {
        process.exit();
    }
}

const username = process.argv[2];
if (!username) {
    console.log('Please provide a telegram username: npx ts-node grant-admin.ts your_username');
    process.exit();
}

grantAdmin(username);
