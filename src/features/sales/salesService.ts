import { db } from '../../config/firebase';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { SaleRecord, NumberRecord, SalesVendorRecord, PaymentRecord } from '../../shared/types/data';
import { logger } from '../../core/logger/logger';
import { calculateDigitalRoot } from '../../shared/utils/utils';

export type VendorSalesStats = {
    vendorName: string;
    totalBilled: number;
    totalPurchaseAmount: number;
    profitLoss: number;
    totalPaid: number;
    amountRemaining: number;
    totalRecords: number;
};

export type SalesSearchCriteria = {
    startWith?: string;
    anywhere?: string;
    endWith?: string;
    mustContain?: string;
    notContain?: string;
    onlyContain?: string;
    total?: string;
    sum?: string;
    minPrice?: string;
    maxPrice?: string;
};

/**
 * Gets sales numbers with optional employee filtering.
 */
export const getSalesNumbers = async (employeeName?: string): Promise<SaleRecord[]> => {
    try {
        let query: any = db.collection('sales');
        if (employeeName) {
            query = query.where('originalNumberData.assignedTo', '==', employeeName);
        }
        const snapshot = await query.get();
        const results = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as SaleRecord));
        return results.sort((a: SaleRecord, b: SaleRecord) => (b.srNo || 0) - (a.srNo || 0));
    } catch (error: any) {
        logger.error(`Error in getSalesNumbers: ${error.message}`);
        throw error;
    }
};

/**
 * Advanced search for sales numbers.
 */
export const searchSalesNumbers = async (criteria: SalesSearchCriteria, employeeName?: string): Promise<SaleRecord[]> => {
    try {
        let query: any = db.collection('sales');
        if (employeeName) {
            query = query.where('originalNumberData.assignedTo', '==', employeeName);
        }

        const snapshot = await query.get();
        let sales = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as SaleRecord));

        const { startWith, endWith, anywhere, mustContain, notContain, onlyContain, total, sum, minPrice, maxPrice } = criteria;

        return sales.filter((sale: SaleRecord) => {
            const mobile = sale.mobile;
            if (startWith && !mobile.startsWith(startWith)) return false;
            if (endWith && !mobile.endsWith(endWith)) return false;
            if (anywhere && !mobile.includes(anywhere)) return false;

            if (mustContain) {
                const digits = mustContain.split(',').map(d => d.trim()).filter(Boolean);
                if (!digits.every(d => mobile.includes(d))) return false;
            }

            if (notContain) {
                const digits = notContain.split(',').map(d => d.trim()).filter(Boolean);
                if (digits.some(d => mobile.includes(d))) return false;
            }

            if (onlyContain) {
                const allowed = new Set(onlyContain.split(''));
                if (!mobile.split('').every(d => allowed.has(d))) return false;
            }

            if (total) {
                const simpleSum = mobile.split('').map(Number).reduce((a, b) => a + b, 0);
                if (simpleSum.toString() !== total) return false;
            }

            if (sum && sale.sum.toString() !== sum) return false;

            if (minPrice && Number(sale.salePrice) < Number(minPrice)) return false;
            if (maxPrice && Number(sale.salePrice) > Number(maxPrice)) return false;

            return true;
        });
    } catch (error: any) {
        logger.error(`Error in searchSalesNumbers: ${error.message}`);
        throw error;
    }
};

/**
 * Gets details for a specific sales number.
 */
export const getSaleDetails = async (mobile: string, employeeName?: string): Promise<SaleRecord | null> => {
    try {
        let query: any = db.collection('sales').where('mobile', '==', mobile);
        if (employeeName) {
            query = query.where('originalNumberData.assignedTo', '==', employeeName);
        }
        const snapshot = await query.limit(1).get();
        if (snapshot.empty) return null;
        return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as SaleRecord;
    } catch (error: any) {
        logger.error(`Error in getSaleDetails: ${error.message}`);
        throw error;
    }
};

/**
 * Cancels a sale and moves the number back to inventory.
 */
export const cancelSale = async (saleId: string, performedBy: string): Promise<boolean> => {
    try {
        const saleRef = db.collection('sales').doc(saleId);
        const saleDoc = await saleRef.get();
        if (!saleDoc.exists) return false;

        const saleData = saleDoc.data() as SaleRecord;
        const now = Timestamp.now();

        // Prepare history cycle
        const historyEvent = {
            id: Math.random().toString(36).substring(2, 11),
            action: 'Sale Cancelled',
            description: 'Sale cancelled and number returned to inventory.',
            timestamp: now,
            performedBy
        };

        const originalData = saleData.originalNumberData;
        const numberData: any = {
            ...originalData,
            assignedTo: 'Unassigned',
            name: 'Unassigned',
            history: [...(originalData.history || []), historyEvent]
        };

        const batch = db.batch();
        const numberRef = db.collection('numbers').doc(); // Create new ID or use original if possible
        // The original ID is not explicitly stored in SaleRecord according to the interface, 
        // but originalNumberData contains all fields. 
        // In the UI, addActivity logs 'Cancelled Sale'.
        
        batch.set(db.collection('numbers').doc(), numberData);
        batch.delete(saleRef);

        await batch.commit();
        return true;
    } catch (error: any) {
        logger.error(`Error in cancelSale: ${error.message}`);
        throw error;
    }
};

/**
 * Fetches all sales vendors.
 */
export const getSalesVendors = async (): Promise<SalesVendorRecord[]> => {
    try {
        const snapshot = await db.collection('salesVendors').orderBy('name', 'asc').get();
        return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as SalesVendorRecord));
    } catch (error: any) {
        logger.error(`Error in getSalesVendors: ${error.message}`);
        throw error;
    }
};

/**
 * Calculates sales statistics for a specific vendor.
 */
export const getVendorSalesStats = async (vendorName: string) => {
    try {
        // Fetch all sales for this vendor
        const salesSnapshot = await db.collection('sales')
            .where('soldTo', '==', vendorName)
            .get();
        
        const sales = salesSnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as SaleRecord));

        // Fetch all payments for this vendor from salesPayments collection
        const paymentsSnapshot = await db.collection('salesPayments')
            .where('vendorName', '==', vendorName)
            .get();
        
        const payments = paymentsSnapshot.docs.map((doc: any) => doc.data() as PaymentRecord);

        const totalBilled = sales.reduce((sum, s) => sum + (s.salePrice || 0), 0);
        const totalPurchaseAmount = sales.reduce((sum, s) => sum + (s.originalNumberData?.purchasePrice || 0), 0);
        const profitLoss = totalBilled - totalPurchaseAmount;
        const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
        const amountRemaining = totalBilled - totalPaid;

        return {
            vendorName,
            totalBilled,
            totalPurchaseAmount,
            profitLoss,
            totalPaid,
            amountRemaining,
            totalRecords: sales.length,
            records: sales.map(s => ({
                mobile: s.mobile,
                sum: s.sum,
                soldTo: s.soldTo,
                salePrice: s.salePrice,
                saleDate: (s.saleDate as any).toDate(),
                saleReason: s.saleReason || '',
                originalNumberData: s.originalNumberData
            })),
            payments: payments.map(p => ({
                amount: p.amount,
                paymentDate: (p.paymentDate as any).toDate()
            }))
        };
    } catch (error: any) {
        logger.error(`Error in getVendorSalesStats for ${vendorName}: ${error.message}`);
        throw error;
    }
};

/**
 * Records a payment from a vendor.
 */
export const addPaymentRecord = async (data: { vendorName: string, amount: number, paymentDate: Date, notes?: string }, createdBy: string) => {
    try {
        const paymentsCollection = db.collection('salesPayments');
        
        // Get next srNo
        const lastPayment = await paymentsCollection.orderBy('srNo', 'desc').limit(1).get();
        const nextSrNo = lastPayment.empty ? 1 : lastPayment.docs[0].data().srNo + 1;

        const newPayment: Omit<PaymentRecord, 'id'> = {
            ...data,
            srNo: nextSrNo,
            paymentDate: Timestamp.fromDate(data.paymentDate),
            createdBy
        };

        const docRef = await paymentsCollection.add(newPayment);
        return docRef.id;
    } catch (error: any) {
        logger.error(`Error in addPaymentRecord: ${error.message}`);
        throw error;
    }
};
