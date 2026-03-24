
import { db } from '../src/config/firebase';

async function listUsers() {
    try {
        const snapshot = await db.collection('users').get();
        if (snapshot.empty) {
            console.log('No users found.');
            return;
        }
        console.log('--- Authorized Users ---');
        snapshot.forEach(doc => {
            const data = doc.data();
            console.log(`Document ID: ${doc.id}`);
            console.log(`- telegramUsername: ${data.telegramUsername}`);
            console.log(`- role: ${data.role}`);
            console.log(`- displayName: ${data.displayName}`);
            console.log('-------------------------');
        });
    } catch (error) {
        console.error('Error fetching users:', error);
    } finally {
        process.exit();
    }
}

listUsers();
