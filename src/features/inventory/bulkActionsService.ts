import { db } from '../../config/firebase';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import type { NumberRecord, User } from '../../shared/types/data';
import { analyzeNumberEntries } from '../../shared/utils/numberActions';
import { indiaDay } from '../../shared/utils/systemReminders';

export type BulkChange =
    | { kind: 'ownership'; ownershipType: 'Individual' | 'Partnership'; partnerName: string }
    | { kind: 'status'; status: 'RTP' | 'Non-RTP'; date: Date | null }
    | { kind: 'checkin'; date: Date };

export async function getBulkActor(username?: string): Promise<User> {
    if (!username) throw new Error('Set a Telegram username and link it to your user profile first.');
    const snapshot = await db.collection('users').where('telegramUsername', '==', username.replace(/^@/, '')).get();
    if (snapshot.docs.length !== 1) throw new Error('Your Telegram username must be linked to exactly one registered user.');
    const actor = { ...snapshot.docs[0].data(), id: snapshot.docs[0].id } as User;
    if (!['admin', 'employee'].includes(actor.role) || !actor.displayName || !actor.uid) {
        throw new Error('Sign in with a complete admin or employee profile.');
    }
    return actor;
}

export function canAccessNumber(actor: User, number: NumberRecord) {
    return actor.role === 'admin' || actor.role === 'employee' && number.assignedTo === actor.displayName;
}

export async function reviewBulkEntries(input: string, actor: User) {
    const mobiles = [...new Set(input.split(/[,\r\n]+/).map(value => value.trim()).filter(value => /^\d{10}$/.test(value)))];
    const numbers: NumberRecord[] = [];
    for (let offset = 0; offset < mobiles.length; offset += 30) {
        const snapshot = await db.collection('numbers').where('mobile', 'in', mobiles.slice(offset, offset + 30)).get();
        for (const doc of snapshot.docs) {
            const number = { ...doc.data(), id: doc.id } as NumberRecord;
            if (canAccessNumber(actor, number)) numbers.push(number);
        }
    }
    return analyzeNumberEntries(input, numbers);
}

export function validateBulkChange(change: BulkChange) {
    if (change.kind === 'ownership') {
        if (!['Individual', 'Partnership'].includes(change.ownershipType)) throw new Error('Choose Individual or Partnership.');
        if (change.ownershipType === 'Partnership' && (!change.partnerName.trim() || change.partnerName.trim().length > 120)) {
            throw new Error('Enter a partner name of 1–120 characters.');
        }
    } else if (change.kind === 'status') {
        if (!['RTP', 'Non-RTP'].includes(change.status)) throw new Error('Choose RTP or Non-RTP.');
        if (change.status === 'Non-RTP' && (!change.date || !Number.isFinite(change.date.getTime()) || indiaDay(change.date)! <= indiaDay(new Date())!)) {
            throw new Error('Choose a future RTP date (IST) for Non-RTP numbers.');
        }
    } else if (change.kind === 'checkin') {
        if (!change.date || !Number.isFinite(change.date.getTime())) throw new Error('Choose a valid check-in date.');
    } else throw new Error('Unsupported bulk action.');
}

const millis = (value: Timestamp | null | undefined) => value?.toMillis() ?? null;
export function buildBulkChange(number: NumberRecord, change: BulkChange) {
    if (change.kind === 'ownership') {
        const partner = change.ownershipType === 'Partnership' ? change.partnerName.trim() : '';
        if (number.ownershipType === change.ownershipType && (number.partnerName || '') === partner) return null;
        return {
            fields: { ownershipType: change.ownershipType, partnerName: partner },
            description: `${number.mobile}: ${number.ownershipType}${number.partnerName ? ` (${number.partnerName})` : ''} → ${change.ownershipType}${partner ? ` (${partner})` : ''}.`
        };
    }
    if (change.kind === 'status') {
        const date = change.status === 'Non-RTP' ? Timestamp.fromDate(change.date!) : null;
        if (number.status === change.status && millis(number.rtpDate) === millis(date)) return null;
        return {
            fields: { status: change.status, rtpDate: date },
            description: `${number.mobile}: ${number.status} (RTP date: ${indiaDay(number.rtpDate) || 'not set'}) → ${change.status} (RTP date: ${indiaDay(date) || 'not set'}, IST).`
        };
    }
    const date = Timestamp.fromDate(change.date);
    if (millis(number.checkInDate) === millis(date)) return null;
    return {
        fields: { checkInDate: date },
        description: `${number.mobile}: Check-in date ${indiaDay(number.checkInDate) || 'not set'} → ${indiaDay(date)} (IST); location: ${number.currentLocation || 'N/A'}.`
    };
}

function previewMatches(current: NumberRecord, preview: NumberRecord, change: BulkChange) {
    if (current.mobile !== preview.mobile) return false;
    if (change.kind === 'ownership') return current.ownershipType === preview.ownershipType && (current.partnerName || '') === (preview.partnerName || '');
    if (change.kind === 'status') return current.status === preview.status && millis(current.rtpDate) === millis(preview.rtpDate);
    return millis(current.checkInDate) === millis(preview.checkInDate) && current.currentLocation === preview.currentLocation;
}

async function nextActivityNumber() {
    const last = await db.collection('activities').orderBy('srNo', 'desc').limit(1).get();
    return (last.docs[0]?.data().srNo || 0) + 1;
}

export async function saveBulkChange(actor: User, previews: NumberRecord[], change: BulkChange, operationId: string) {
    validateBulkChange(change);
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(operationId)) throw new Error('Invalid operation. Start a new review.');
    const selected = [...new Map(previews.map(number => [number.id, number])).values()];
    const srNo = await nextActivityNumber();
    const action = { ownership: 'Bulk Updated Ownership', status: 'Bulk Updated RTP Status', checkin: 'Bulk Updated Check-In Date' }[change.kind];
    let saved = 0;
    try {
        for (let offset = 0; offset < selected.length; offset += 40) {
            const chunk = selected.slice(offset, offset + 40);
            const activityRef = db.collection('activities').doc(`bot-bulk-${operationId}-${offset}`);
            saved += await db.runTransaction(async transaction => {
                const profile = await transaction.get(db.collection('users').doc(actor.id));
                const currentActor = profile.data() as User | undefined;
                if (!currentActor || currentActor.uid !== actor.uid || currentActor.role !== actor.role ||
                    currentActor.displayName !== actor.displayName || currentActor.telegramUsername !== actor.telegramUsername) {
                    throw new Error('Your permissions changed. Start a new review.');
                }
                const completed = await transaction.get(activityRef);
                if (completed.exists) {
                    const data = completed.data()!;
                    if (data.createdBy !== actor.uid || data.operationId !== operationId) throw new Error('Invalid operation owner.');
                    return data.updatedCount as number;
                }
                const snapshots = await Promise.all(chunk.map(number => transaction.get(db.collection('numbers').doc(number.id))));
                const changes = snapshots.flatMap((snapshot, index) => {
                    if (!snapshot.exists) throw new Error('A number is no longer available. Enter the numbers again to review.');
                    const current = { ...snapshot.data(), id: snapshot.id } as NumberRecord;
                    if (!canAccessNumber(actor, current)) throw new Error('A number is no longer assigned to you. Start a new review.');
                    if (!previewMatches(current, chunk[index], change)) throw new Error(`${current.mobile} changed since your preview. Enter the numbers again to review.`);
                    const update = buildBulkChange(current, change);
                    return update ? [{ ref: snapshot.ref, update }] : [];
                });
                if (!changes.length) return 0;
                for (const { ref, update } of changes) transaction.update(ref, {
                    ...update.fields,
                    history: FieldValue.arrayUnion({ id: randomUUID(), action, description: update.description, timestamp: Timestamp.now(), performedBy: actor.displayName })
                });
                transaction.set(activityRef, {
                    employeeName: actor.displayName, action,
                    groupName: change.kind === 'checkin' ? 'SIM_LOCATIONS' : 'INVENTORY',
                    description: changes.map(({ update }) => update.description).join('\n'),
                    createdBy: actor.uid, source: 'BOT', timestamp: FieldValue.serverTimestamp(),
                    srNo: srNo + offset / 40, notificationStatus: 'Pending', operationId, updatedCount: changes.length
                });
                return changes.length;
            });
        }
    } catch (error) {
        throw new Error(`${saved ? `${saved} number(s) already saved and logged. ` : ''}${error instanceof Error ? error.message : 'Unable to save changes.'}`);
    }
    return saved;
}

export type LocationFilters = { type: string; location: string; search: string; mobile: string };
export const describeLocationFilters = (filters: LocationFilters) => `Location type: ${filters.type}; location: ${filters.location}; location search: ${filters.search || 'all'}; mobile search: ${filters.mobile || 'all'}`;
export function filterLocations(numbers: NumberRecord[], filters: LocationFilters) {
    return numbers.filter(number => (filters.type === 'all' || number.locationType === filters.type)
        && (filters.location === 'all' || number.currentLocation === filters.location)
        && (number.currentLocation || '').toLowerCase().includes(filters.search.trim().toLowerCase())
        && number.mobile.includes(filters.mobile.trim()))
        .sort((a, b) => a.mobile.localeCompare(b.mobile));
}

export async function accessibleInventory(actor: User) {
    const collection = db.collection('numbers');
    const snapshot = await (actor.role === 'admin' ? collection : collection.where('assignedTo', '==', actor.displayName)).get();
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as NumberRecord)).filter(number => canAccessNumber(actor, number));
}

export async function queueLocationActivity(actor: User, action: string, description: string) {
    await db.collection('activities').doc().set({
        employeeName: actor.displayName, action, description, createdBy: actor.uid,
        source: 'BOT', groupName: 'SIM_LOCATIONS', srNo: await nextActivityNumber(),
        timestamp: FieldValue.serverTimestamp(), notificationStatus: 'Pending'
    });
}

/** Do not export a stale location or a record reassigned since selection. */
export async function reviewLocationExport(actor: User, previews: NumberRecord[]) {
    const inventory = await accessibleInventory(actor);
    const current = new Map(inventory.map(number => [number.id, number]));
    return previews.map(preview => {
        const number = current.get(preview.id);
        if (!number || number.mobile !== preview.mobile || number.currentLocation !== preview.currentLocation || number.locationType !== preview.locationType) {
            throw new Error('Search results changed or a number is no longer available. Refresh the search before copying.');
        }
        return number;
    });
}
