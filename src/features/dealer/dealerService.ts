import { db } from '../../config/firebase';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { DealerPurchaseRecord, NewDealerPurchaseData, DealerRecord, NewDealerData } from '../../shared/types/data';
import { logger } from '../../core/logger/logger';
import { calculateDigitalRoot } from '../../shared/utils/utils';

export async function getDealerPurchases(employeeUid?: string) {
    try {
        let query: any = db.collection('dealerPurchases');
        if (employeeUid) {
            query = query.where("createdBy", "==", employeeUid);
        }
        const snapshot = await query.get();
        return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as DealerPurchaseRecord));
    } catch (error: any) {
        logger.error(`Error in getDealerPurchases: ${error.message}`);
        throw error;
    }
}

export async function addDealerPurchaseStep(data: NewDealerPurchaseData, creatorUid: string) {
    try {
        const ref = db.collection('dealerPurchases');
        
        // Get next srNo
        const snapshot = await ref.orderBy('srNo', 'desc').limit(1).get();
        const srNo = snapshot.empty ? 1 : snapshot.docs[0].data().srNo + 1;

        const now = Timestamp.now();
        const historyEvent = {
            id: Math.random().toString(36).substring(2, 11),
            action: 'Dealer Purchase Created',
            description: `Dealer purchase record created for ${data.mobile} from dealer ${data.dealerName} via BOT.`,
            timestamp: now,
            performedBy: creatorUid // Since we might not have a clean name here, we'll use creatorUid or fetch name later
        };

        const newPurchase: Omit<DealerPurchaseRecord, 'id'> = {
            ...data,
            srNo,
            sum: calculateDigitalRoot(data.mobile),
            createdBy: creatorUid,
            history: [historyEvent]
        };

        await ref.add(newPurchase);
        return true;
    } catch (error: any) {
        logger.error(`Error in addDealerPurchaseStep: ${error.message}`);
        throw error;
    }
}

export async function deleteDealerPurchase(id: string) {
    try {
        await db.collection('dealerPurchases').doc(id).delete();
        return true;
    } catch (error: any) {
        logger.error(`Error in deleteDealerPurchase: ${error.message}`);
        throw error;
    }
}

export async function getDealerPurchaseByMobile(mobile: string, employeeUid?: string) {
    try {
        let query: any = db.collection('dealerPurchases').where("mobile", "==", mobile);
        if (employeeUid) {
            query = query.where("createdBy", "==", employeeUid);
        }
        const snapshot = await query.get();
        if (snapshot.empty) return null;
        return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as DealerPurchaseRecord;
    } catch (error: any) {
        logger.error(`Error in getDealerPurchaseByMobile: ${error.message}`);
        throw error;
    }
}

export async function getDealers(): Promise<string[]> {
    try {
        const snapshot = await db.collection('dealers').get();
        return snapshot.docs.map(doc => doc.data().name).sort();
    } catch (error: any) {
        logger.error(`Error in getDealers: ${error.message}`);
        throw error;
    }
}

export async function addDealer(data: NewDealerData, creatorUid: string) {
    try {
        const ref = db.collection('dealers');
        const newDealer = {
            ...data,
            createdAt: Timestamp.now(),
            createdBy: creatorUid
        };
        await ref.add(newDealer);
        return true;
    } catch (error: any) {
        logger.error(`Error in addDealer: ${error.message}`);
        throw error;
    }
}

export async function deleteDealer(id: string) {
    try {
        await db.collection('dealers').doc(id).delete();
        return true;
    } catch (error: any) {
        logger.error(`Error in deleteDealer: ${error.message}`);
        throw error;
    }
}

export async function getDealerPurchaseStats(dealerName?: string) {
    try {
        let purchasesQuery: any = db.collection('dealerPurchases');
        if (dealerName) {
            purchasesQuery = purchasesQuery.where("dealerName", "==", dealerName);
        }
        const purchasesSnapshot = await purchasesQuery.get();
        const purchases = purchasesSnapshot.docs.map((doc: any) => doc.data() as DealerPurchaseRecord);

        const totalBilled = purchases.reduce((sum: number, p: DealerPurchaseRecord) => sum + (p.price || 0), 0);
        
        let paymentsQuery: any = db.collection('dealerPayments');
        if (dealerName) {
            paymentsQuery = paymentsQuery.where("vendorName", "==", dealerName);
        } else {
            // If global, we need to only sum payments for names that are actually dealers
            const dealers = await getDealers();
            if (dealers.length === 0) return { totalBilled, totalPaid: 0, amountRemaining: totalBilled, totalRecords: purchases.length, records: purchases };
            // For Dealer Purchase, user said "all calculation based on all available data no vendor dependency"
            // This might mean "sum all payments where the vendor is ANY registered dealer"
            // Since Firebase has a limit of 10 for 'in' query, we might need a better approach if there are many dealers.
            // But if we use 'where("vendorName", "in", dealers)', it works for up to 10.
            if (dealers.length <= 10) {
                paymentsQuery = paymentsQuery.where("vendorName", "in", dealers);
            } else {
                // If more than 10 dealers, we'll have to fetch all payments and filter in memory, or use multiple queries.
                // Given the context, let's assume we can fetch and filter.
            }
        }
        
        const paymentsSnapshot = await paymentsQuery.get();
        const payments = paymentsSnapshot.docs.map((doc: any) => doc.data());
        const totalPaid = payments.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

        return {
            totalBilled,
            totalPaid,
            amountRemaining: totalBilled - totalPaid,
            totalRecords: purchases.length,
            records: purchases.map((p: DealerPurchaseRecord) => ({
                mobile: p.mobile,
                sum: p.sum,
                dealerName: p.dealerName,
                price: p.price
            }))
        };
    } catch (error: any) {
        logger.error(`Error in getDealerPurchaseStats: ${error.message}`);
        throw error;
    }
}

export async function addDealerPaymentRecord(data: { vendorName: string, amount: number, paymentDate: Date, notes?: string }, createdBy: string) {
    try {
        const paymentsCollection = db.collection('dealerPayments');
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
        logger.error(`Error in addDealerPaymentRecord: ${error.message}`);
        throw error;
    }
}
