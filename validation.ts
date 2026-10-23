import { z } from "zod";

const amountString = z.string().trim().regex(/^\d+(?:\.\d{1,8})?$/, "Enter a valid non-negative decimal with up to 8 decimal places.");
const code = z.string().trim().toUpperCase().regex(/^[A-Z]{3,8}$/, "Use an explicit currency code.");
const optionalUuid = z.string().uuid().optional().nullable();

export const financialDraftSchema = z.object({
  businessId: z.string().uuid(),
  kind: z.enum(["fx_purchase", "fx_sale", "ticket", "umrah", "expense", "income", "customer_payment", "supplier_payment"]),
  transactionDate: z.string().datetime().optional(),
  quantity: amountString.optional(),
  tradedCurrency: code.optional(),
  settlementCurrency: code.optional(),
  rate: amountString.optional(),
  baseRate: amountString.optional(),
  grossAmount: amountString.optional(),
  fee: amountString.optional(),
  totalAmount: amountString.optional(),
  costAmount: amountString.optional(),
  paymentAmount: amountString.optional(),
  paymentAccountId: optionalUuid,
  supplierPaidAmount: amountString.optional(),
  supplierPaymentAccountId: optionalUuid,
  customerId: optionalUuid,
  supplierId: optionalUuid,
  location: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(180).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
  booking: z.object({
    serviceType: z.enum(["ticket", "umrah"]),
    bookingReference: z.string().trim().max(80).optional().nullable(),
    bookingStatus: z.enum(["quotation", "reserved", "issued", "paid", "cancelled"]).default("quotation"),
    passengerName: z.string().trim().max(120).optional().nullable(),
    airlineName: z.string().trim().max(120).optional().nullable(),
    origin: z.string().trim().max(100).optional().nullable(),
    destination: z.string().trim().max(100).optional().nullable(),
    travelDate: z.string().datetime().optional().nullable(),
    serviceDescription: z.string().trim().max(500).optional().nullable(),
  }).optional(),
}).strict();

export const contactSchema = z.object({
  businessId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().max(180).optional().or(z.literal("")).nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
}).strict();

export const businessSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.enum(["currency_exchange", "travel_agency", "other"]),
  baseCurrency: code,
  timezone: z.string().trim().min(1).max(80).default("Africa/Cairo"),
}).strict();

export const settingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  baseCurrency: code,
  timezone: z.string().trim().min(1).max(80),
  address: z.string().trim().max(240).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().max(180).optional().or(z.literal("")).nullable(),
  logoUrl: z.string().trim().max(500).optional().nullable(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  terms: z.string().trim().max(1500).optional().nullable(),
}).strict();

export const accountSchema = z.object({
  businessId: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  type: z.enum(["cash", "bank"]),
  currencyCode: code,
}).strict();

export const staffSchema = z.object({
  businessId: z.string().uuid(),
  email: z.string().trim().email().max(180),
  role: z.enum(["manager", "staff", "viewer"]),
}).strict();

export type FinancialDraftInput = z.infer<typeof financialDraftSchema>;
