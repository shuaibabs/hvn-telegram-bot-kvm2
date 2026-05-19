import { db } from '../../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';
import { NumberRecord, DealerSaleRecord, DealerDeleteRecord, NewBasicPremiumVendorData } from '../../shared/types/data';
import { logger } from '../../core/logger/logger';
import { calculateDigitalRoot } from '../../shared/utils/utils';

export async function getBPInventory(type: 'basic' | 'premium', employeeUid?: string) {
    try {
        let query: any = db.collection(type);
        if (employeeUid) {
            query = query.where("createdBy", "==", employeeUid);
        }
        const snapshot = await query.get();
        return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as NumberRecord));
    } catch (error: any) {
        logger.error(`Error in getBPInventory (${type}): ${error.message}`);
        throw error;
    }
}

export async function addBPNumber(type: 'basic' | 'premium', data: any, creatorUid: string) {
    try {
        const ref = db.collection(type);
        
        // Get next srNo
        const snapshot = await ref.orderBy('srNo', 'desc').limit(1).get();
        const srNo = snapshot.empty ? 1 : snapshot.docs[0].data().srNo + 1;

        const now = Timestamp.now();
        const historyEvent = {
            id: Math.random().toString(36).substring(2, 11),
            action: 'Created',
            description: `Number added to ${type} inventory via BOT.`,
            timestamp: now,
            performedBy: creatorUid 
        };

        const newRecord = {
            ...data,
            srNo,
            sum: calculateDigitalRoot(data.mobile),
            createdBy: creatorUid,
            history: [historyEvent],
            purchaseDate: Timestamp.now(),
            status: 'Non-RTP',
            numberType: 'Prepaid',
            uploadStatus: 'Pending',
            currentLocation: 'Dealer',
            locationType: 'Dealer',
            assignedTo: 'Unassigned',
        };

        await ref.add(newRecord);
        return true;
    } catch (error: any) {
        logger.error(`Error in addBPNumber (${type}): ${error.message}`);
        throw error;
    }
}

export async function markBPNumberAsSold(id: string, type: 'basic' | 'premium', salePrice: number, performedBy: string) {
    try {
        const docRef = db.collection(type).doc(id);
        const docSnap = await docRef.get();
        if (!docSnap.exists) throw new Error("Number not found.");

        const data = docSnap.data() as NumberRecord;
        const now = Timestamp.now();

        const saleRecord: Omit<DealerSaleRecord, 'id'> = {
            srNo: data.srNo,
            mobile: data.mobile,
            sum: data.sum,
            dealerName: data.purchaseFrom,
            purchasePrice: data.purchasePrice,
            salePrice,
            saleDate: now,
            stockType: type === 'premium' ? 'Premium' : 'Basic',
            createdBy: data.createdBy,
            performedBy
        };

        await db.collection('basicPremiumSales').add(saleRecord);
        await docRef.delete();
        return true;
    } catch (error: any) {
        logger.error(`Error in markBPNumberAsSold: ${error.message}`);
        throw error;
    }
}

export async function moveBPNumberToDeletes(id: string, type: 'basic' | 'premium', deletedBy: string, reason?: string) {
    try {
        const docRef = db.collection(type).doc(id);
        const docSnap = await docRef.get();
        if (!docSnap.exists) throw new Error("Number not found.");

        const data = docSnap.data() as NumberRecord;
        const now = Timestamp.now();

        const deleteRecord: Omit<DealerDeleteRecord, 'id'> = {
            srNo: data.srNo,
            mobile: data.mobile,
            sum: data.sum,
            dealerName: data.purchaseFrom,
            purchasePrice: data.purchasePrice,
            deletedAt: now,
            deletedBy,
            reason: reason || 'Manual Deletion',
            stockType: type === 'premium' ? 'Premium' : 'Basic'
        };

        await db.collection('basicPremiumDeletes').add(deleteRecord);
        await docRef.delete();
        return true;
    } catch (error: any) {
        logger.error(`Error in moveBPNumberToDeletes: ${error.message}`);
        throw error;
    }
}

export async function getBPNumberByMobile(mobile: string, employeeUid?: string) {
    try {
        // Search in both collections
        for (const type of ['basic', 'premium'] as const) {
            let query: any = db.collection(type).where("mobile", "==", mobile);
            if (employeeUid) {
                query = query.where("createdBy", "==", employeeUid);
            }
            const snapshot = await query.get();
            if (!snapshot.empty) {
                return { id: snapshot.docs[0].id, type, ...snapshot.docs[0].data() } as (NumberRecord & { type: 'basic' | 'premium' });
            }
        }
        return null;
    } catch (error: any) {
        logger.error(`Error in getBPNumberByMobile: ${error.message}`);
        throw error;
    }
}

export async function getBPVendors(): Promise<string[]> {
    try {
        const snapshot = await db.collection('basicPremiumVendors').get();
        return snapshot.docs.map(doc => doc.data().name).sort();
    } catch (error: any) {
        logger.error(`Error in getBPVendors: ${error.message}`);
        throw error;
    }
}

export async function addBPVendor(data: NewBasicPremiumVendorData, creatorUid: string) {
    try {
        const ref = db.collection('basicPremiumVendors');
        const newVendor = {
            ...data,
            createdAt: Timestamp.now(),
            createdBy: creatorUid
        };
        await ref.add(newVendor);
        return true;
    } catch (error: any) {
        logger.error(`Error in addBPVendor: ${error.message}`);
        throw error;
    }
}

export async function getBPStats(vendorName?: string) {
    try {
        // Fetch from sales and payments only
        const salesSnap = await db.collection('basicPremiumSales').get();
        const salesItems = salesSnap.docs.map((d: any) => d.data());
        
        let filteredSales = salesItems;
        if (vendorName) {
            filteredSales = salesItems.filter(i => i.dealerName === vendorName);
        }

        // Compute totalBilled across sold items only
        let totalBilled = 0;
        filteredSales.forEach(i => {
            totalBilled += (Number(i.purchasePrice) || 0);
        });
        
        let paymentsQuery: any = db.collection('basicPremiumPayments');
        if (vendorName) {
            paymentsQuery = paymentsQuery.where("vendorName", "==", vendorName);
        }
        
        const paymentsSnap = await paymentsQuery.get();
        const payments = paymentsSnap.docs.map((d: any) => d.data());
        const totalPaid = payments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);

        return {
            totalBilled,
            totalPaid,
            amountRemaining: totalBilled - totalPaid,
            totalRecords: filteredSales.length,
            records: filteredSales.map(i => ({
                mobile: i.mobile,
                sum: i.sum,
                vendorName: i.dealerName,
                price: Number(i.purchasePrice) || 0
            }))
        };
    } catch (error: any) {
        logger.error(`Error in getBPStats: ${error.message}`);
        throw error;
    }
}

export async function updateBPNumberSalePrice(id: string, type: 'basic' | 'premium', newSalePrice: number) {
    try {
        await db.collection(type).doc(id).update({
            salePrice: newSalePrice
        });
        return true;
    } catch (error: any) {
        logger.error(`Error in updateBPNumberSalePrice: ${error.message}`);
        throw error;
    }
}

export async function addBPPaymentRecord(data: { vendorName: string, amount: number, paymentDate: Date, notes?: string }, createdBy: string) {
    try {
        const paymentsCollection = db.collection('basicPremiumPayments');
        const lastPayment = await paymentsCollection.orderBy('srNo', 'desc').limit(1).get();
        const nextSrNo = lastPayment.empty ? 1 : lastPayment.docs[0].data().srNo + 1;

        const newPayment = {
            ...data,
            srNo: nextSrNo,
            paymentDate: Timestamp.fromDate(data.paymentDate),
            createdBy
        };

        const docRef = await paymentsCollection.add(newPayment);
        return docRef.id;
    } catch (error: any) {
        logger.error(`Error in addBPPaymentRecord: ${error.message}`);
        throw error;
    }
}
