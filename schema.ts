import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    preferredLanguage: text("preferred_language").notNull().default("en"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)],
);

export const businesses = pgTable(
  "businesses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    category: text("category").notNull(),
    baseCurrency: text("base_currency").notNull().default("EGP"),
    timezone: text("timezone").notNull().default("Africa/Cairo"),
    address: text("address"),
    phone: text("phone"),
    email: text("email"),
    logoUrl: text("logo_url"),
    primaryColor: text("primary_color").notNull().default("#13243d"),
    accentColor: text("accent_color").notNull().default("#c9a66b"),
    receiptSequence: integer("receipt_sequence").notNull().default(0),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("businesses_slug_idx").on(table.slug)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("staff"),
    permissions: jsonb("permissions").$type<Record<string, boolean>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("memberships_user_business_idx").on(table.userId, table.businessId),
    index("memberships_business_idx").on(table.businessId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("sessions_token_hash_idx").on(table.tokenHash)],
);

export const businessCurrencies = pgTable(
  "business_currencies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    decimalPlaces: integer("decimal_places").notNull().default(2),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("business_currencies_business_code_idx").on(table.businessId, table.code)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    currencyCode: text("currency_code").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("accounts_business_code_idx").on(table.businessId, table.code),
    index("accounts_business_currency_idx").on(table.businessId, table.currencyCode),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("customers_business_name_idx").on(table.businessId, table.name)],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("suppliers_business_name_idx").on(table.businessId, table.name)],
);

export const financialTransactions = pgTable(
  "financial_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("draft"),
    transactionDate: timestamp("transaction_date", { withTimezone: true }).notNull().defaultNow(),
    quantity: numeric("quantity", { precision: 28, scale: 8 }),
    tradedCurrency: text("traded_currency"),
    settlementCurrency: text("settlement_currency"),
    rate: numeric("rate", { precision: 28, scale: 8 }),
    baseRate: numeric("base_rate", { precision: 28, scale: 8 }),
    grossAmount: numeric("gross_amount", { precision: 28, scale: 8 }),
    fee: numeric("fee", { precision: 28, scale: 8 }).notNull().default("0"),
    totalAmount: numeric("total_amount", { precision: 28, scale: 8 }),
    costAmount: numeric("cost_amount", { precision: 28, scale: 8 }).notNull().default("0"),
    paymentAmount: numeric("payment_amount", { precision: 28, scale: 8 }).notNull().default("0"),
    paymentAccountId: uuid("payment_account_id").references(() => accounts.id, { onDelete: "set null" }),
    supplierPaidAmount: numeric("supplier_paid_amount", { precision: 28, scale: 8 }).notNull().default("0"),
    supplierPaymentAccountId: uuid("supplier_payment_account_id").references(() => accounts.id, { onDelete: "set null" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    location: text("location"),
    description: text("description"),
    notes: text("notes"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    receiptNumber: text("receipt_number"),
    idempotencyKey: text("idempotency_key"),
    creatorId: uuid("creator_id").notNull().references(() => users.id),
    approverId: uuid("approver_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    version: integer("version").notNull().default(1),
    reversalOfId: uuid("reversal_of_id"),
    reversedById: uuid("reversed_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("financial_transactions_business_date_idx").on(table.businessId, table.transactionDate),
    index("financial_transactions_business_status_idx").on(table.businessId, table.status),
    uniqueIndex("financial_transactions_idempotency_idx").on(table.businessId, table.idempotencyKey),
    uniqueIndex("financial_transactions_receipt_idx").on(table.businessId, table.receiptNumber),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").notNull().references(() => financialTransactions.id, { onDelete: "cascade" }),
    serviceType: text("service_type").notNull(),
    bookingReference: text("booking_reference"),
    bookingStatus: text("booking_status").notNull().default("quotation"),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    passengerName: text("passenger_name"),
    airlineName: text("airline_name"),
    origin: text("origin"),
    destination: text("destination"),
    travelDate: timestamp("travel_date", { withTimezone: true }),
    serviceDescription: text("service_description"),
    currencyCode: text("currency_code").notNull(),
    saleAmount: numeric("sale_amount", { precision: 28, scale: 8 }).notNull(),
    costAmount: numeric("cost_amount", { precision: 28, scale: 8 }).notNull().default("0"),
    paidAmount: numeric("paid_amount", { precision: 28, scale: 8 }).notNull().default("0"),
    supplierPaidAmount: numeric("supplier_paid_amount", { precision: 28, scale: 8 }).notNull().default("0"),
    baseRate: numeric("base_rate", { precision: 28, scale: 8 }),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("bookings_transaction_idx").on(table.transactionId),
    index("bookings_business_status_idx").on(table.businessId, table.bookingStatus),
    index("bookings_reference_idx").on(table.businessId, table.bookingReference),
  ],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").notNull().references(() => financialTransactions.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    currencyCode: text("currency_code").notNull(),
    debit: numeric("debit", { precision: 28, scale: 8 }).notNull().default("0"),
    credit: numeric("credit", { precision: 28, scale: 8 }).notNull().default("0"),
    baseCurrency: text("base_currency").notNull(),
    functionalDebit: numeric("functional_debit", { precision: 28, scale: 8 }).notNull().default("0"),
    functionalCredit: numeric("functional_credit", { precision: 28, scale: 8 }).notNull().default("0"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("journal_business_account_idx").on(table.businessId, table.accountId),
    index("journal_transaction_idx").on(table.transactionId),
  ],
);

export const rateHistory = pgTable(
  "rate_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
    baseCurrency: text("base_currency").notNull(),
    quoteCurrency: text("quote_currency").notNull(),
    rate: numeric("rate", { precision: 28, scale: 8 }).notNull(),
    source: text("source").notNull().default("owner-entered"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    enteredBy: uuid("entered_by").notNull().references(() => users.id),
  },
  (table) => [index("rate_history_business_pair_idx").on(table.businessId, table.baseCurrency, table.quoteCurrency, table.capturedAt)],
);

export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").notNull().references(() => financialTransactions.id, { onDelete: "cascade" }),
    receiptNumber: text("receipt_number").notNull(),
    documentType: text("document_type").notNull().default("final-transaction-receipt"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("receipts_business_number_idx").on(table.businessId, table.receiptNumber),
    uniqueIndex("receipts_transaction_idx").on(table.transactionId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_business_created_idx").on(table.businessId, table.createdAt),
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
  ],
);
