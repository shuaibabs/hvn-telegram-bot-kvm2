import { db } from '../../config/firebase';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { NumberRecord } from '../../shared/types/data';
import { indiaDay, isReminderDue } from '../../shared/utils/systemReminders';

/** Also runs without an open dashboard. Transactions prevent UI/bot double conversion. */
export async function activateScheduledRtp(numbers: NumberRecord[]) {
    const eligible = numbers.filter(number => number.status === 'Non-RTP' && isReminderDue(number.rtpDate));
    const converted = new Set<string>();
    if (!eligible.length) return converted;
    const last = await db.collection('activities').orderBy('srNo', 'desc').limit(1).get();
    let srNo = (last.docs[0]?.data().srNo || 0) + 1;
    for (let offset = 0; offset < eligible.length; offset += 40) {
        const activityRef = db.collection('activities').doc();
        const ids = await db.runTransaction(async transaction => {
            const snapshots = await Promise.all(eligible.slice(offset, offset + 40).map(number => transaction.get(db.collection('numbers').doc(number.id))));
            const changes = snapshots.flatMap(snapshot => {
                if (!snapshot.exists) return [];
                const current = { ...snapshot.data(), id: snapshot.id } as NumberRecord;
                if (current.status !== 'Non-RTP' || !isReminderDue(current.rtpDate)) return [];
                return [{ ref: snapshot.ref, current, description: `${current.mobile}: Non-RTP → RTP; scheduled date ${indiaDay(current.rtpDate)} arrived (IST); Account: ${current.accountName || 'N/A'}.` }];
            });
            if (!changes.length) return [];
            for (const { ref, description } of changes) transaction.update(ref, {
                status: 'RTP', rtpDate: null,
                history: FieldValue.arrayUnion({ id: randomUUID(), action: 'RTP Status Changed', description, timestamp: Timestamp.now(), performedBy: 'System' })
            });
            transaction.set(activityRef, {
                employeeName: 'System', action: 'Auto-updated to RTP', groupName: 'INVENTORY',
                description: changes.map(change => change.description).join('\n'), source: 'BOT', createdBy: 'system',
                srNo, timestamp: FieldValue.serverTimestamp(), notificationStatus: 'Pending'
            });
            return changes.map(change => change.current.id);
        });
        ids.forEach(id => converted.add(id));
        if (ids.length) srNo++;
    }
    return converted;
}
