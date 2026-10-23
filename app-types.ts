export type Business = {
  id: string;
  name: string;
  slug: string;
  category: string;
  baseCurrency: string;
  timezone: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  primaryColor: string;
  accentColor: string;
  settings?: Record<string, unknown>;
  role?: string;
  permissions?: Record<string, boolean>;
};

export type Transaction = {
  id: string;
  businessId: string;
  kind: string;
  status: string;
  transactionDate: string;
  quantity: string | null;
  tradedCurrency: string | null;
  settlementCurrency: string | null;
  rate: string | null;
  baseRate: string | null;
  grossAmount: string | null;
  fee: string;
  totalAmount: string | null;
  costAmount: string;
  paymentAmount: string;
  paymentAccountId: string | null;
  supplierPaidAmount: string;
  supplierPaymentAccountId: string | null;
  customerId: string | null;
  supplierId: string | null;
  location: string | null;
  description: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  receiptNumber: string | null;
  creatorId: string;
  approverId: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  version: number;
  reversalOfId: string | null;
  reversedById: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TransactionRow = { transaction: Transaction; customerName: string | null; supplierName: string | null };

export type StockRow = {
  currency: string;
  quantity: string;
  carryingValue: string;
  averageCost: string;
  baseCurrency: string;
};

export type Account = {
  id: string;
  businessId: string;
  name: string;
  code: string;
  type: string;
  currencyCode: string;
  active: boolean;
  isSystem: boolean;
  balance: string;
  functionalBalance: string;
};

export type Currency = { id: string; businessId: string; code: string; name: string; symbol: string; decimalPlaces: number; active: boolean };
export type Contact = { id: string; businessId: string; name: string; phone: string | null; email: string | null; notes: string | null; createdAt: string };
export type ContactBalance = { currency: string; balance: string };
export type ContactHistoryItem = { transaction: Transaction; booking: Booking | null };
export type ContactDetail = { contact: Contact; balances: ContactBalance[]; history: ContactHistoryItem[] };

export type Booking = {
  id: string;
  businessId: string;
  transactionId: string;
  serviceType: string;
  bookingReference: string | null;
  bookingStatus: string;
  customerId: string | null;
  supplierId: string | null;
  passengerName: string | null;
  airlineName: string | null;
  origin: string | null;
  destination: string | null;
  travelDate: string | null;
  serviceDescription: string | null;
  currencyCode: string;
  saleAmount: string;
  costAmount: string;
  paidAmount: string;
  supplierPaidAmount: string;
  baseRate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};
export type BookingRow = { booking: Booking; transaction: Transaction; customerName: string | null; supplierName: string | null };

export type Overview = {
  business: Pick<Business, "id" | "name" | "category" | "baseCurrency" | "timezone" | "logoUrl" | "primaryColor" | "accentColor">;
  today: {
    date: string;
    timezone: string;
    revenue: string;
    expenses: string;
    realizedExchangeGains: string;
    realizedExchangeLosses: string;
    netProfit: string;
    cashFlow: string;
    currency: string;
  };
  pendingApprovals: number;
  stocks: StockRow[];
  accounts: Account[];
  receivables: Account[];
  payables: Account[];
  counts: { customers: number; suppliers: number; bookings: number };
  recentTransactions: Transaction[];
};

export type Report = {
  from: string;
  to: string;
  reportingCurrency: string;
  revenue: string;
  expenses: string;
  realizedExchangeGains: string;
  realizedExchangeLosses: string;
  netProfit: string;
  cashFlowByCurrency: Record<string, string>;
  ledgerByCurrency: Array<{ accountType: string; currency: string; debit: string; credit: string; functionalDebit: string; functionalCredit: string }>;
};

export type ReceiptRow = { receipt: Record<string, unknown>; transaction: Transaction; customerName: string | null };
export type ReceiptDocument = {
  businessName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  receiptNumber: string;
  transactionDate: string;
  title: string;
  kind: string;
  customerName: string | null;
  description: string | null;
  currency: string | null;
  currencySymbol: string | null;
  quantity: string | null;
  tradedCurrency: string | null;
  rate: string | null;
  fee: string;
  totalAmount: string | null;
  amountPaid: string | null;
  amountOutstanding: string | null;
  paymentStatus: string;
  booking: null | {
    serviceType: string;
    bookingReference: string | null;
    status: string;
    passengerName: string | null;
    airlineName: string | null;
    origin: string | null;
    destination: string | null;
    travelDate: string | null;
    serviceDescription: string | null;
  };
  terms: string | null;
};

export type StaffRow = { membership: { id: string; role: string; permissions: Record<string, boolean>; createdAt: string }; userName: string; email: string };
export type AuditEvent = { id: string; action: string; entityType: string; entityId: string | null; details: Record<string, unknown>; createdAt: string; actorName: string | null; actorEmail: string | null };
export type ExchangeRate = { rate: { id: string; baseCurrency: string; quoteCurrency: string; rate: string; source: string; capturedAt: string }; enteredByName: string | null };
export type AssistantMessage = { id: string; role: "assistant" | "user"; text: string; time: string; draftId?: string };
