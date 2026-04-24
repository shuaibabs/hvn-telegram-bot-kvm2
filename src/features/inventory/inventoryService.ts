import { db } from '../../config/firebase';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { NumberRecord, NewNumberData } from '../../shared/types/data';
import { numberRecordSchema } from '../../shared/utils/validation';
import { calculateDigitalRoot } from '../../shared/utils/utils';
import { logger } from '../../core/logger/logger';

/**
 * Checks if a mobile number already exists in the 'numbers' collection.
 */
export const isMobileNumberDuplicate = async (mobile: string): Promise<boolean> => {
    const snapshot = await db.collection('numbers').where('mobile', '==', mobile).get();
    return !snapshot.empty;
};

/**
 * Adds multiple numbers to the inventory.
 * Handles sequence numbering (srNo) and digital root calculation (sum).
 */
export const addInventoryNumbers = async (
    data: NewNumberData,
    validNumbers: string[],
    createdByUid: string,
    creatorName: string
): Promise<{ successCount: number; duplicateCount: number; duplicates: string[]; errors: string[] }> => {
    if (validNumbers.length === 0) return { successCount: 0, duplicateCount: 0, duplicates: [], errors: [] };

    const results = {
        successCount: 0,
        duplicateCount: 0,
        duplicates: [] as string[],
        errors: [] as string[]
    };

    try {
        const numbersCollection = db.collection('numbers');

        // Get starting srNo
        const lastNumber = await numbersCollection.orderBy('srNo', 'desc').limit(1).get();
        let currentSrNo = lastNumber.empty ? 1 : lastNumber.docs[0].data().srNo + 1;

        const batch = db.batch();
        const now = Timestamp.now();

        const processedMobiles = new Set<string>();

        for (const mobile of validNumbers) {
            // Check for duplicates in current batch
            if (processedMobiles.has(mobile)) {
                results.duplicateCount++;
                results.duplicates.push(mobile);
                continue;
            }

            // Check for duplicates in database (across all collections)
            const existence = await getNumberDetails(mobile);
            if (existence.found) {
                results.duplicateCount++;
                results.duplicates.push(mobile);
                continue;
            }

            processedMobiles.add(mobile);

            const newDocRef = numbersCollection.doc();

            // Construct Lifecycle Event
            const historyEvent = {
                id: Math.random().toString(36).substring(2, 11),
                action: 'Created',
                description: `Number added to inventory by ${creatorName} (BOT).`,
                timestamp: now,
                performedBy: creatorName
            };

            const newNumber: any = {
                ...data,
                id: newDocRef.id,
                mobile,
                srNo: currentSrNo++,
                sum: calculateDigitalRoot(mobile),
                rtpDate: data.status === 'Non-RTP' && data.rtpDate ? Timestamp.fromDate(data.rtpDate) : null,
                safeCustodyDate: data.numberType === 'COCP' && data.safeCustodyDate ? Timestamp.fromDate(data.safeCustodyDate) : null,
                unsafeCustodyDate: data.numberType === 'COCP' && data.unsafeCustodyDate ? Timestamp.fromDate(data.unsafeCustodyDate) : null,
                billDate: data.numberType === 'Postpaid' && data.billDate ? Timestamp.fromDate(data.billDate) : null,
                assignedTo: data.assignedTo || 'Unassigned',
                name: data.assignedTo || 'Unassigned',
                checkInDate: null,
                createdBy: createdByUid,
                purchaseDate: Timestamp.fromDate(data.purchaseDate),
                history: [historyEvent]
            };

            // Cleanup based on type (consistent with UI logic)
            if (data.ownershipType !== 'Partnership') {
                newNumber.partnerName = '';
            }
            if (data.numberType !== 'COCP') {
                delete newNumber.accountName;
                delete newNumber.safeCustodyDate;
                delete newNumber.unsafeCustodyDate;
            }
            if (data.numberType !== 'Postpaid') {
                delete newNumber.billDate;
                delete newNumber.pdBill;
            }

            // Simple validation check before batch
            // Note: numberRecordSchema might fail on srNo or id if not handled correctly
            // but we are constructing it here.

            batch.set(newDocRef, newNumber);
            results.successCount++;
        }

        if (results.successCount > 0) {
            await batch.commit();
        }

        return results;
    } catch (error: any) {
        logger.error('Error in addInventoryNumbers: ' + error.message);
        throw error;
    }
};

/**
 * Checks which mobile numbers exist in the 'numbers' collection.
 */
export const validateNumbersExistence = async (mobiles: string[]): Promise<{ existing: string[]; missing: string[] }> => {
    if (mobiles.length === 0) return { existing: [], missing: [] };

    const existing: string[] = [];
    const missing: string[] = [];

    // Query in chunks of 10 because Firestore 'in' query has a limit of 10-30 depending on version
    // But here we might have many numbers, so let's check one by one or in small batches
    // For simplicity and reliability with common comma-separated inputs (usually < 50), we can check existence.
    const numbersCollection = db.collection('numbers');

    for (const mobile of mobiles) {
        const snapshot = await numbersCollection.where('mobile', '==', mobile).limit(1).get();
        if (!snapshot.empty) {
            existing.push(mobile);
        } else {
            missing.push(mobile);
        }
    }

    return { existing, missing };
};

/**
 * Updates status, upload status, or location for multiple numbers.
 */
export const updateNumbersStatusBatch = async (
    mobiles: string[],
    updates: Partial<NumberRecord>,
    performedBy: string
): Promise<{ successCount: number; errors: string[] }> => {
    const results = { successCount: 0, errors: [] as string[] };
    const batch = db.batch();
    const now = Timestamp.now();

    try {
        const numbersCollection = db.collection('numbers');

        for (const mobile of mobiles) {
            const snapshot = await numbersCollection.where('mobile', '==', mobile).limit(1).get();
            if (snapshot.empty) continue;

            const doc = snapshot.docs[0];
            const oldData = doc.data();

            const historyEvent = {
                id: Math.random().toString(36).substring(2, 11),
                action: 'Updated',
                description: `Manual update via BOT: ${Object.keys(updates).join(', ')}`,
                timestamp: now,
                performedBy
            };

            const finalUpdates: any = { ...updates };
            if (updates.status === 'Non-RTP' && updates.rtpDate) {
                finalUpdates.rtpDate = Timestamp.fromDate(updates.rtpDate as unknown as Date);
            } else if (updates.status === 'RTP') {
                finalUpdates.rtpDate = null;
            }

            batch.update(doc.ref, {
                ...finalUpdates,
                history: [...(oldData.history || []), historyEvent]
            });
            results.successCount++;
        }

        if (results.successCount > 0) {
            await batch.commit();
        }
        return results;
    } catch (error: any) {
        logger.error('Error in updateNumbersStatusBatch: ' + error.message);
        throw error;
    }
};

/**
 * Assigns numbers to a specific user.
 */
export const assignNumbersToUser = async (
    mobiles: string[],
    assignedTo: string,
    performedBy: string
): Promise<{ successCount: number }> => {
    const batch = db.batch();
    const now = Timestamp.now();
    let successCount = 0;

    const numbersCollection = db.collection('numbers');
    for (const mobile of mobiles) {
        const snapshot = await numbersCollection.where('mobile', '==', mobile).limit(1).get();
        if (snapshot.empty) continue;

        const doc = snapshot.docs[0];
        const oldData = doc.data();

        const historyEvent = {
            id: Math.random().toString(36).substring(2, 11),
            action: 'Assigned',
            description: `Assigned to ${assignedTo} via BOT.`,
            timestamp: now,
            performedBy
        };

        batch.update(doc.ref, {
            assignedTo,
            name: assignedTo, // Keeping name synced with assignedTo as per existing logic
            history: [...(oldData.history || []), historyEvent]
        });
        successCount++;
    }

    if (successCount > 0) {
        await batch.commit();
    }
    return { successCount };
};

/**
 * Soft deletes numbers by moving them to deletedNumbers collection.
 */
export const softDeleteNumbers = async (
    mobiles: string[],
    performedBy: string,
    deletionReason: string = 'Deleted via BOT'
): Promise<{ successCount: number }> => {
    const batch = db.batch();
    const now = Timestamp.now();
    let successCount = 0;

    const numbersCollection = db.collection('numbers');
    const deletedCollection = db.collection('deletedNumbers');

    for (const mobile of mobiles) {
        const snapshot = await numbersCollection.where('mobile', '==', mobile).limit(1).get();
        if (snapshot.empty) continue;

        const doc = snapshot.docs[0];
        const data = doc.data() as NumberRecord;

        const deletedDocRef = deletedCollection.doc();
        const historyEvent = {
            id: Math.random().toString(36).substring(2, 11),
            action: 'Deleted',
            description: `Deleted from inventory via BOT. Reason: ${deletionReason}`,
            timestamp: now,
            performedBy
        };

        const deletedRecord = {
            id: deletedDocRef.id,
            originalId: doc.id,
            originalSrNo: data.srNo,
            mobile: data.mobile,
            sum: data.sum,
            deletionReason,
            deletedBy: performedBy,
            deletedAt: now,
            originalNumberData: {
                ...data,
                history: [...(data.history || []), historyEvent]
            }
        };

        batch.set(deletedDocRef, deletedRecord);
        batch.delete(doc.ref);
        successCount++;
    }

    if (successCount > 0) {
        await batch.commit();
    }
    return { successCount };
};

/**
 * Gets all numbers (for admin/monitoring purposes if needed).
 */
export const getAllNumbers = async (): Promise<NumberRecord[]> => {
    const snapshot = await db.collection('numbers').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as NumberRecord));
};

/**
 * Moves numbers from inventory to sales collection.
 */
export const markAsSoldBatch = async (
    mobiles: string[],
    details: { salePrice: number; soldTo: string; saleDate: Date; remark?: string; saleReason?: string },
    createdByUid: string,
    creatorName: string
): Promise<{ successCount: number }> => {
    const batch = db.batch();
    const now = Timestamp.now();
    let successCount = 0;

    const numbersCollection = db.collection('numbers');
    const salesCollection = db.collection('sales');

    // Get starting srNo for sales
    const lastSale = await salesCollection.orderBy('srNo', 'desc').limit(1).get();
    let currentSrNo = lastSale.empty ? 1 : lastSale.docs[0].data().srNo + 1;

    for (const mobile of mobiles) {
        const snapshot = await numbersCollection.where('mobile', '==', mobile).limit(1).get();
        if (snapshot.empty) continue;

        const doc = snapshot.docs[0];
        const numberData = doc.data() as NumberRecord;

        const historyEvent = {
            id: Math.random().toString(36).substring(2, 11),
            action: 'Sold',
            description: `Sold to ${details.soldTo} for ₹${details.salePrice} via BOT.`,
            timestamp: now,
            performedBy: creatorName
        };

        const newSale = {
            srNo: currentSrNo++,
            mobile: numberData.mobile,
            sum: calculateDigitalRoot(numberData.mobile),
            salePrice: details.salePrice,
            soldTo: details.soldTo,
            uploadStatus: numberData.uploadStatus || 'Pending',
            saleDate: Timestamp.fromDate(details.saleDate),
            createdBy: createdByUid,
            originalNumberData: {
                ...numberData,
                history: [...(numberData.history || []), historyEvent]
            },
            remark: details.remark || '',
            saleReason: details.saleReason || ''
        };

        const saleDocRef = salesCollection.doc();
        batch.set(saleDocRef, newSale);
        batch.delete(doc.ref);
        successCount++;
    }

    if (successCount > 0) {
        await batch.commit();
    }
    return { successCount };
};

/**
 * Moves numbers from inventory to prebookings collection.
 */
export const prebookNumbersBatch = async (
    mobiles: string[],
    createdByUid: string,
    creatorName: string
): Promise<{ successCount: number }> => {
    const batch = db.batch();
    const now = Timestamp.now();
    let successCount = 0;

    const numbersCollection = db.collection('numbers');
    const prebookingsCollection = db.collection('prebookings');

    // Get starting srNo for prebookings
    const lastPrebook = await prebookingsCollection.orderBy('srNo', 'desc').limit(1).get();
    let currentSrNo = lastPrebook.empty ? 1 : lastPrebook.docs[0].data().srNo + 1;

    for (const mobile of mobiles) {
        const snapshot = await numbersCollection.where('mobile', '==', mobile).limit(1).get();
        if (snapshot.empty) continue;

        const doc = snapshot.docs[0];
        const numberData = doc.data() as NumberRecord;

        const historyEvent = {
            id: Math.random().toString(36).substring(2, 11),
            action: 'Pre-Booked',
            description: `Moved to pre-booking list via BOT.`,
            timestamp: now,
            performedBy: creatorName
        };

        const newPrebooking = {
            srNo: currentSrNo++,
            mobile: numberData.mobile,
            sum: numberData.sum,
            uploadStatus: numberData.uploadStatus,
            preBookingDate: now,
            createdBy: createdByUid,
            originalNumberData: {
                ...numberData,
                history: [...(numberData.history || []), historyEvent]
            }
        };

        const prebookDocRef = prebookingsCollection.doc();
        batch.set(prebookDocRef, newPrebooking);
        batch.delete(doc.ref);
        successCount++;
    }

    if (successCount > 0) {
        await batch.commit();
    }
    return { successCount };
};

/**
 * Gets unique vendors from the 'salesVendors' collection.
 */
export const getExistingVendors = async (): Promise<string[]> => {
    const snapshot = await db.collection('salesVendors').select('name').get();
    const vendorsSet = new Set<string>();
    snapshot.docs.forEach(doc => {
        const name = doc.data().name;
        if (name) vendorsSet.add(name);
    });
    return Array.from(vendorsSet).sort();
};

/**
 * Adds a new vendor to the 'salesVendors' collection if it doesn't already exist.
 */
export const addNewVendor = async (vendorName: string, createdByUid: string): Promise<void> => {
    const trimmedName = vendorName.trim();
    if (!trimmedName) return;

    const existing = await getExistingVendors();
    const exists = existing.some(v => v.toLowerCase() === trimmedName.toLowerCase());

    if (!exists) {
        await db.collection('salesVendors').add({
            name: trimmedName,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: createdByUid
        });
    }
};

export type AdvancedSearchCriteria = {
    startWith?: string;
    anywhere?: string;
    endWith?: string;
    mustContain?: string;
    notContain?: string;
    onlyContain?: string;
    total?: string;
    sum?: string;
    maxContain?: string;
    ownershipType?: 'Partnership' | 'Individual' | 'all';
    minPrice?: string;
    maxPrice?: string;
};

/**
 * Searches for a number across all relevant collections to provide full history/details.
 */
export const getNumberDetails = async (mobile: string): Promise<{
    found: boolean,
    location: 'Inventory' | 'Sales' | 'Prebooked' | 'Deleted' | 'None',
    data: any
}> => {
    // 1. Check Inventory
    const invSnapshot = await db.collection('numbers').where('mobile', '==', mobile).limit(1).get();
    if (!invSnapshot.empty) return { found: true, location: 'Inventory', data: invSnapshot.docs[0].data() };

    // 2. Check Sales
    const salesSnapshot = await db.collection('sales').where('mobile', '==', mobile).limit(1).get();
    if (!salesSnapshot.empty) return { found: true, location: 'Sales', data: salesSnapshot.docs[0].data() };

    // 3. Check Prebookings
    const preSnapshot = await db.collection('prebookings').where('mobile', '==', mobile).limit(1).get();
    if (!preSnapshot.empty) return { found: true, location: 'Prebooked', data: preSnapshot.docs[0].data() };

    // 4. Check Deleted
    const delSnapshot = await db.collection('deletedNumbers').where('mobile', '==', mobile).limit(1).get();
    if (!delSnapshot.empty) return { found: true, location: 'Deleted', data: delSnapshot.docs[0].data() };

    return { found: false, location: 'None', data: null };
};

const calculateSimpleSum = (mobile: string): number => {
    return mobile.split('').map(Number).reduce((acc, digit) => acc + digit, 0);
};

/**
 * Performs advanced search on the 'numbers' collection (Inventory).
 */
export const advancedSearchNumbers = async (criteria: AdvancedSearchCriteria): Promise<NumberRecord[]> => {
    let query: any = db.collection('numbers');

    // Basic Firestore filtering where possible (Equality)
    if (criteria.ownershipType && criteria.ownershipType !== 'all') {
        query = query.where('ownershipType', '==', criteria.ownershipType);
    }

    // Fetch and filter in-memory for complex logic (RegEx-like)
    const snapshot = await query.get();
    let numbers = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as NumberRecord));

    const { startWith, endWith, anywhere, mustContain, notContain, onlyContain, total, sum, maxContain, minPrice, maxPrice } = criteria;

    return numbers.filter((num: NumberRecord) => {
        if (startWith && !num.mobile.startsWith(startWith)) return false;
        if (endWith && !num.mobile.endsWith(endWith)) return false;
        if (anywhere && !num.mobile.includes(anywhere)) return false;

        if (mustContain) {
            const digits = mustContain.split(',').map(d => d.trim()).filter(Boolean);
            if (!digits.every(d => num.mobile.includes(d))) return false;
        }

        if (notContain) {
            const digits = notContain.split(',').map(d => d.trim()).filter(Boolean);
            if (digits.some(d => num.mobile.includes(d))) return false;
        }

        if (onlyContain) {
            const allowed = new Set(onlyContain.split(''));
            if (!num.mobile.split('').every(d => allowed.has(d))) return false;
        }

        if (total) {
            if (calculateSimpleSum(num.mobile).toString() !== total) return false;
        }

        if (sum && num.sum.toString() !== sum) return false;

        if (maxContain) {
            const counts: Record<string, number> = {};
            for (const d of num.mobile) counts[d] = (counts[d] || 0) + 1;
            if (Math.max(...Object.values(counts)) > parseInt(maxContain)) return false;
        }

        if (minPrice && Number(num.salePrice) < Number(minPrice)) return false;
        if (maxPrice && Number(num.salePrice) > Number(maxPrice)) return false;

        return true;
    });
};
