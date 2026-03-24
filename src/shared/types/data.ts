import { Timestamp } from 'firebase-admin/firestore';

// Base User profile stored in Firestore
export type User = {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'employee';
  id: string; // Firestore document ID is the same as uid
  telegramUsername?: string;
};

// New type for individual history events on a number
export type LifecycleEvent = {
  id: string; // A unique ID for the event
  action: string;
  description: string;
  timestamp: Timestamp;
  performedBy: string; // Name of the user or 'System'
};

// Raw record from Firestore
export type NumberRecord = {
  id: string; // Firestore document ID
  srNo: number;
  mobile: string;
  sum: number;
  status: 'RTP' | 'Non-RTP';
  uploadStatus: 'Pending' | 'Done';
  numberType: 'Prepaid' | 'Postpaid' | 'COCP';
  purchaseFrom: string;
  purchasePrice: number;
  salePrice: number | string;
  rtpDate: Timestamp | null;
  name: string;
  currentLocation: string;
  locationType: 'Store' | 'Employee' | 'Dealer';
  assignedTo: string; // Can be 'Unassigned', or employee name
  purchaseDate: Timestamp;
  notes?: string;
  checkInDate: Timestamp | null;
  safeCustodyDate: Timestamp | null;
  createdBy: string; // UID of user who created it
  accountName?: string;
  ownershipType: 'Individual' | 'Partnership';
  partnerName?: string;
  billDate?: Timestamp | null;
  pdBill?: 'Yes' | 'No';
  history?: LifecycleEvent[]; // Array to store the number's entire history
};

// Type for creating a new number, omitting Firestore-generated fields
export type NewNumberData = Omit<
  NumberRecord,
  'id' | 'srNo' | 'createdBy' | 'checkInDate' | 'purchaseDate' | 'sum' | 'safeCustodyDate' | 'billDate' | 'history' | 'rtpDate'
> & { purchaseDate: Date; rtpDate?: Date, safeCustodyDate?: Date, billDate?: Date };


export type SaleRecord = {
  id: string; // Firestore document ID
  srNo: number;
  mobile: string;
  sum: number;
  soldTo: string;
  salePrice: number;
  saleDate: Timestamp;
  uploadStatus: 'Pending' | 'Done';
  createdBy: string;
  originalNumberData: Omit<NumberRecord, 'id'>;
};

export type DeletedNumberRecord = {
  id: string; // Firestore document ID in the deletedNumbers collection
  originalId: string; // ID from the 'numbers' collection
  originalSrNo: number;
  mobile: string;
  sum: number;
  deletionReason: string;
  deletedBy: string; // Name of user
  deletedAt: Timestamp;
  originalNumberData: Omit<NumberRecord, 'id'>;
};

export type PreBookingRecord = {
  id: string; // Firestore document ID
  srNo: number;
  mobile: string;
  sum: number;
  uploadStatus: 'Pending' | 'Done';
  preBookingDate: Timestamp;
  createdBy: string;
  originalNumberData: Omit<NumberRecord, 'id'>;
}

export type Reminder = {
  id: string; // Firestore document ID
  srNo: number;
  taskId?: string; // Unique ID to prevent duplicate reminders for the same event
  taskName: string;
  assignedTo: string[];
  status: 'Done' | 'Pending';
  dueDate: Timestamp;
  createdBy: string;
  completionDate?: Timestamp;
  notes?: string;
};

export type NewReminderData = Omit<Reminder, 'id' | 'srNo' | 'createdBy' | 'status' | 'dueDate' | 'notes' | 'completionDate' | 'taskId'> & { dueDate: Date };


export type Activity = {
  id: string; // Firestore document ID
  srNo: number;
  employeeName: string;
  action: string;
  description: string;
  timestamp: Timestamp;
  createdBy: string;
  source: 'UI' | 'BOT';
  groupName?: string;
};

export type DealerPurchaseRecord = {
  id: string; // Firestore document ID
  srNo: number;
  mobile: string;
  sum: number;
  dealerName: string;
  price: number;
  createdBy: string;
  history?: LifecycleEvent[];
};

export type NewDealerPurchaseData = Omit<DealerPurchaseRecord, 'id' | 'srNo' | 'createdBy' | 'sum'>;

export type PaymentRecord = {
  id: string;
  srNo: number;
  vendorName: string;
  amount: number;
  paymentDate: Timestamp;
  notes?: string;
  createdBy: string;
};

export type NewPaymentData = Omit<PaymentRecord, 'id' | 'srNo' | 'createdBy' | 'paymentDate'> & { paymentDate: Date };

export type GlobalHistoryRecord = {
  id: string; // A unique ID for the history record itself (e.g., collection-docId)
  mobile: string;
  rtpStatus: 'RTP' | 'Non-RTP' | 'N/A';
  numberType: 'Prepaid' | 'Postpaid' | 'COCP' | 'N/A';
  currentStage: 'In Inventory' | 'Sold' | 'Pre-Booked' | 'Dealer Purchase' | 'Deleted';
  saleInfo?: {
    soldTo: string;
    saleDate: Timestamp;
    salePrice: number;
  };
  purchaseInfo?: {
    purchaseFrom: string;
    purchaseDate: Timestamp | null;
    purchasePrice: number;
  };
  deletionInfo?: {
    reason: string;
    deletedBy: string;
    deletedAt: Timestamp;
  };
  history?: LifecycleEvent[];
};

export type SalesVendorRecord = {
  id: string; // Firestore document ID
  name: string; // The vendor's unique name
  createdAt: Timestamp;
  createdBy: string;
};

export type NewSalesVendorData = Omit<SalesVendorRecord, 'id' | 'createdAt' | 'createdBy'>;

export type DealerRecord = {
  id: string;
  name: string;
  createdAt: Timestamp;
  createdBy: string;
};

export type NewDealerData = Omit<DealerRecord, 'id' | 'createdAt' | 'createdBy'>;
