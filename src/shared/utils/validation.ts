import { z } from 'zod';
import { Timestamp } from 'firebase-admin/firestore';

// Multi-environment Timestamp validation
const timestampSchema = z.custom<Timestamp>((val) => {
    return val instanceof Timestamp || (val && typeof (val as any).toDate === 'function');
}, { message: "Invalid Firestore Timestamp" });

export const userSchema = z.object({
    uid: z.string(),
    email: z.string().email(),
    displayName: z.string(),
    role: z.enum(['admin', 'employee']),
    id: z.string(),
    telegramUsername: z.string().optional(),
});

export const lifecycleEventSchema = z.object({
    id: z.string(),
    action: z.string(),
    description: z.string(),
    timestamp: timestampSchema,
    performedBy: z.string(),
});

export const numberRecordSchema = z.object({
    id: z.string(),
    srNo: z.number(),
    mobile: z.string(),
    sum: z.number(),
    status: z.enum(['RTP', 'Non-RTP']),
    uploadStatus: z.enum(['Pending', 'Done']),
    numberType: z.enum(['Prepaid', 'Postpaid', 'COCP']),
    purchaseFrom: z.string(),
    purchasePrice: z.number(),
    salePrice: z.union([z.number(), z.string()]),
    rtpDate: timestampSchema.nullable(),
    name: z.string(),
    currentLocation: z.string(),
    locationType: z.enum(['Store', 'Employee', 'Dealer']),
    assignedTo: z.string(),
    purchaseDate: timestampSchema,
    notes: z.string().optional(),
    checkInDate: timestampSchema.nullable(),
    safeCustodyDate: timestampSchema.nullable(),
    createdBy: z.string(),
    accountName: z.string().optional(),
    ownershipType: z.enum(['Individual', 'Partnership']),
    partnerName: z.string().optional(),
    billDate: timestampSchema.nullable().optional(),
    pdBill: z.enum(['Yes', 'No']).optional(),
    history: z.array(lifecycleEventSchema).optional(),
});

export const saleRecordSchema = z.object({
    id: z.string(),
    srNo: z.number(),
    mobile: z.string(),
    sum: z.number(),
    soldTo: z.string(),
    salePrice: z.number(),
    saleDate: timestampSchema,
    uploadStatus: z.enum(['Pending', 'Done']),
    createdBy: z.string(),
    originalNumberData: numberRecordSchema.omit({ id: true }),
});

export const activitySchema = z.object({
    id: z.string(),
    srNo: z.number(),
    employeeName: z.string(),
    action: z.string(),
    description: z.string(),
    timestamp: timestampSchema,
    createdBy: z.string(),
    source: z.enum(['UI', 'BOT']),
    groupName: z.string().optional(),
});

export const reminderSchema = z.object({
    id: z.string(),
    srNo: z.number(),
    taskId: z.string().optional(),
    taskName: z.string(),
    assignedTo: z.array(z.string()),
    status: z.enum(['Done', 'Pending']),
    dueDate: timestampSchema,
    createdBy: z.string(),
    completionDate: timestampSchema.optional(),
    notes: z.string().optional(),
});

export const dealerPurchaseRecordSchema = z.object({
    id: z.string(),
    srNo: z.number(),
    mobile: z.string(),
    sum: z.number(),
    dealerName: z.string(),
    price: z.number(),
    createdBy: z.string(),
});

export const paymentRecordSchema = z.object({
    id: z.string(),
    srNo: z.number(),
    vendorName: z.string(),
    amount: z.number(),
    paymentDate: timestampSchema,
    notes: z.string().optional(),
    createdBy: z.string(),
});

export const globalHistoryRecordSchema = z.object({
    id: z.string(),
    mobile: z.string(),
    rtpStatus: z.enum(['RTP', 'Non-RTP', 'N/A']),
    numberType: z.enum(['Prepaid', 'Postpaid', 'COCP', 'N/A']),
    currentStage: z.enum(['In Inventory', 'Sold', 'Pre-Booked', 'Dealer Purchase', 'Deleted']),
    saleInfo: z.object({
        soldTo: z.string(),
        saleDate: timestampSchema,
        salePrice: z.number(),
    }).optional(),
    purchaseInfo: z.object({
        purchaseFrom: z.string(),
        purchaseDate: timestampSchema.nullable(),
        purchasePrice: z.number(),
    }).optional(),
    deletionInfo: z.object({
        reason: z.string(),
        deletedBy: z.string(),
        deletedAt: timestampSchema,
    }).optional(),
    history: z.array(lifecycleEventSchema).optional(),
});

export const salesVendorRecordSchema = z.object({
    id: z.string(),
    name: z.string(),
    createdAt: timestampSchema,
    createdBy: z.string(),
});
