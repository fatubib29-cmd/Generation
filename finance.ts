import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  auditLogs,
  bookings,
  businesses,
  businessCurrencies,
  customers,
  financialTransactions,
  journalEntries,
  suppliers,
} from "@/db/schema";
import { ApiError } from "@/lib/auth";
import { add, decimalString, divide, multiply, parseDecimal, roundTo } from "@/lib/decimal";
import { currencyForBusiness } from "@/lib/workspace";
import { financialDraftSchema, type FinancialDraftInput } from "@/lib/validation";

const ZERO = BigInt(0);
const ONE = BigInt(100_000_000);

async function currencyPlaces(businessId: string, code: string): Promise<number> {
  const currency = await currencyForBusiness(businessId, code);
  if (!currency) throw new ApiError(`${code} is not enabled for this business. Add it in currency settings first.`);
  return currency.decimalPlaces;
}

async function verifyAccount(
  businessId: string,
  accountId: string | null | undefined,
  currency: string,
  label: string,
): Promise<void> {
  if (!accountId) return;
  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.businessId, businessId), eq(accounts.active, true)))
    .limit(1);
  const account = rows[0];
  if (!account) throw new ApiError(`${label} account was not found in this business.`);
  if (account.type !== "cash" && account.type !== "bank") {
    throw new ApiError(`${label} must use an active cash or bank account.`);
  }
  if (account.currencyCode !== currency) {
    throw new ApiError(`${label} account uses ${account.currencyCode}; this transaction settles in ${currency}.`);
  }
}

async function verifyContact<T extends "customer" | "supplier">(
  businessId: string,
  id: string | null | undefined,
  kind: T,
): Promise<void> {
  if (!id) return;
  const table = kind === "customer" ? customers : suppliers;
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.businessId, businessId)))
    .limit(1);
  if (!rows[0]) throw new ApiError(`${kind === "customer" ? "Customer" : "Supplier"} is not part of this business.`);
}

export type NormalizedDraft = {
  kind: string;
  transactionDate: Date;
  quantity: string | null;
  tradedCurrency: string | null;
  settlementCurrency: string;
  rate: string | null;
  baseRate: string | null;
  grossAmount: string;
  fee: string;
  totalAmount: string;
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
};

export async function normalizeFinancialDraft(input: FinancialDraftInput, baseCurrency: string): Promise<NormalizedDraft> {
  const businessId = input.businessId;
  const kind = input.kind;
  const transactionDate = input.transactionDate ? new Date(input.transactionDate) : new Date();
  if (Number.isNaN(transactionDate.getTime())) throw new ApiError("Transaction date is invalid.");
  const customerId = input.customerId ?? null;
  const supplierId = input.supplierId ?? null;
  await verifyContact(businessId, customerId, "customer");
  await verifyContact(businessId, supplierId, "supplier");

  let settlementCurrency: string;
  let tradedCurrency: string | null = null;
  let quantity: string | null = null;
  let rate: string | null = null;
  let baseRate: string | null = null;
  let grossUnits: bigint;
  let feeUnits: bigint;
  let costUnits = ZERO;
  let paymentUnits = ZERO;
  let supplierPaidUnits = ZERO;
  let paymentAccountId = input.paymentAccountId ?? null;
  let supplierPaymentAccountId = input.supplierPaymentAccountId ?? null;
  const metadata: Record<string, unknown> = {};

  if (kind === "fx_purchase" || kind === "fx_sale") {
    if (!input.quantity || !input.tradedCurrency || !input.settlementCurrency || !input.rate) {
      throw new ApiError("A currency, quantity, settlement currency, and explicit exchange rate are required.");
    }
    tradedCurrency = input.tradedCurrency.toUpperCase();
    settlementCurrency = input.settlementCurrency.toUpperCase();
    await currencyPlaces(businessId, tradedCurrency);
    const places = await currencyPlaces(businessId, settlementCurrency);
    const quantityUnits = parseDecimal(input.quantity, "Quantity");
    const rateUnits = parseDecimal(input.rate, "Exchange rate");
    if (quantityUnits <= ZERO || rateUnits <= ZERO) throw new ApiError("Quantity and exchange rate must be greater than zero.");
    quantity = decimalString(quantityUnits);
    rate = decimalString(rateUnits);
    grossUnits = roundTo(multiply(quantityUnits, rateUnits), places);
    feeUnits = roundTo(parseDecimal(input.fee ?? "0", "Fee"), places);
    if (feeUnits < ZERO) throw new ApiError("Fees cannot be negative.");
    if (input.baseRate) {
      const parsedBaseRate = parseDecimal(input.baseRate, "Reporting-currency rate");
      if (parsedBaseRate <= ZERO) throw new ApiError("Reporting-currency rate must be greater than zero.");
      baseRate = decimalString(parsedBaseRate);
    } else if (settlementCurrency === baseCurrency) {
      baseRate = "1";
    }
    paymentUnits = roundTo(parseDecimal(input.paymentAmount ?? "0", "Amount paid"), places);
    if (paymentUnits < ZERO) throw new ApiError("Amount paid cannot be negative.");
    await verifyAccount(businessId, paymentAccountId, settlementCurrency, "Payment");
    if (paymentUnits > ZERO && !paymentAccountId) {
      throw new ApiError("Choose the cash or bank account that received or paid this amount.");
    }
    if (kind === "fx_purchase") {
      if (supplierPaymentAccountId) throw new ApiError("Supplier payment account is only used for ticket or service costs.");
    } else if (supplierId) {
      throw new ApiError("A supplier is not used on a currency sale; select a customer for any unpaid balance.");
    }
  } else if (kind === "ticket" || kind === "umrah") {
    if (!input.booking || input.booking.serviceType !== kind) {
      throw new ApiError("Booking details are required for a ticket or Umrah service.");
    }
    if (!input.settlementCurrency || !input.grossAmount) {
      throw new ApiError("Select the booking currency and enter its customer selling price.");
    }
    settlementCurrency = input.settlementCurrency.toUpperCase();
    const places = await currencyPlaces(businessId, settlementCurrency);
    grossUnits = roundTo(parseDecimal(input.grossAmount, "Selling price"), places);
    feeUnits = roundTo(parseDecimal(input.fee ?? "0", "Agency charge"), places);
    costUnits = roundTo(parseDecimal(input.costAmount ?? "0", "Supplier cost"), places);
    paymentUnits = roundTo(parseDecimal(input.paymentAmount ?? "0", "Amount received"), places);
    supplierPaidUnits = roundTo(parseDecimal(input.supplierPaidAmount ?? "0", "Supplier amount paid"), places);
    if (grossUnits <= ZERO) throw new ApiError("Selling price must be greater than zero.");
    if (feeUnits < ZERO || costUnits < ZERO || paymentUnits < ZERO || supplierPaidUnits < ZERO) {
      throw new ApiError("Charges, costs, and payment amounts cannot be negative.");
    }
    if (input.baseRate) {
      const parsedBaseRate = parseDecimal(input.baseRate, "Reporting-currency rate");
      if (parsedBaseRate <= ZERO) throw new ApiError("Reporting-currency rate must be greater than zero.");
      baseRate = decimalString(parsedBaseRate);
    } else if (settlementCurrency === baseCurrency) {
      baseRate = "1";
    }
    await verifyAccount(businessId, paymentAccountId, settlementCurrency, "Customer payment");
    await verifyAccount(businessId, supplierPaymentAccountId, settlementCurrency, "Supplier payment");
    if (paymentUnits > ZERO && !paymentAccountId) throw new ApiError("Choose the cash or bank account where the customer's payment was received.");
    if (supplierPaidUnits > ZERO && !supplierPaymentAccountId) throw new ApiError("Choose the cash or bank account used for the supplier payment.");
    const totalCandidate = add(grossUnits, feeUnits);
    if (paymentUnits > totalCandidate) throw new ApiError("Customer payment cannot exceed the selling price and agency charge.");
    if (supplierPaidUnits > costUnits) throw new ApiError("Supplier payments cannot exceed the recorded supplier cost.");
    if (input.booking.bookingStatus === "paid" && paymentUnits !== totalCandidate) {
      throw new ApiError("A booking cannot be marked paid until the full customer amount is recorded as received.");
    }
    metadata.booking = input.booking;
  } else if (kind === "customer_payment" || kind === "supplier_payment") {
    if (!input.settlementCurrency || !input.grossAmount) {
      throw new ApiError("Choose the settlement currency and enter the payment amount.");
    }
    if (kind === "customer_payment" && !customerId) throw new ApiError("Select the customer whose balance is being paid.");
    if (kind === "supplier_payment" && !supplierId) throw new ApiError("Select the supplier being paid.");
    settlementCurrency = input.settlementCurrency.toUpperCase();
    const places = await currencyPlaces(businessId, settlementCurrency);
    grossUnits = roundTo(parseDecimal(input.grossAmount, "Payment amount"), places);
    if (grossUnits <= ZERO) throw new ApiError("Payment amount must be greater than zero.");
    feeUnits = ZERO;
    paymentUnits = grossUnits;
    await verifyAccount(businessId, paymentAccountId, settlementCurrency, "Payment");
    if (!paymentAccountId) throw new ApiError("Choose the cash or bank account used for this payment.");
    if (input.baseRate) {
      const parsedBaseRate = parseDecimal(input.baseRate, "Reporting-currency rate");
      if (parsedBaseRate <= ZERO) throw new ApiError("Reporting-currency rate must be greater than zero.");
      baseRate = decimalString(parsedBaseRate);
    } else if (settlementCurrency === baseCurrency) {
      baseRate = "1";
    }
  } else {
    if (!input.settlementCurrency || !input.grossAmount) {
      throw new ApiError("Choose a currency and enter the income or expense amount.");
    }
    settlementCurrency = input.settlementCurrency.toUpperCase();
    const places = await currencyPlaces(businessId, settlementCurrency);
    grossUnits = roundTo(parseDecimal(input.grossAmount, "Amount"), places);
    feeUnits = roundTo(parseDecimal(input.fee ?? "0", "Additional charge"), places);
    paymentUnits = roundTo(parseDecimal(input.paymentAmount ?? "0", "Amount paid"), places);
    if (grossUnits <= ZERO || feeUnits < ZERO || paymentUnits < ZERO) throw new ApiError("Enter a positive amount and non-negative charge/payment values.");
    if (input.baseRate) {
      const parsedBaseRate = parseDecimal(input.baseRate, "Reporting-currency rate");
      if (parsedBaseRate <= ZERO) throw new ApiError("Reporting-currency rate must be greater than zero.");
      baseRate = decimalString(parsedBaseRate);
    } else if (settlementCurrency === baseCurrency) {
      baseRate = "1";
    }
    await verifyAccount(businessId, paymentAccountId, settlementCurrency, "Payment");
    if (paymentUnits > ZERO && !paymentAccountId) throw new ApiError("Choose the cash or bank account used for this payment.");
  }

  const totalUnits = add(grossUnits, feeUnits);
  const places = await currencyPlaces(businessId, settlementCurrency);
  const roundedTotal = roundTo(totalUnits, places);
  if (paymentUnits > roundedTotal) throw new ApiError("The recorded payment cannot exceed the transaction total.");
  if (kind === "fx_purchase" && input.paymentAmount && paymentUnits > roundedTotal) {
    throw new ApiError("Amount paid cannot exceed the currency purchase cost.");
  }

  return {
    kind,
    transactionDate,
    quantity,
    tradedCurrency,
    settlementCurrency,
    rate,
    baseRate,
    grossAmount: decimalString(grossUnits),
    fee: decimalString(feeUnits),
    totalAmount: decimalString(roundedTotal),
    costAmount: decimalString(costUnits),
    paymentAmount: decimalString(paymentUnits),
    paymentAccountId,
    supplierPaidAmount: decimalString(supplierPaidUnits),
    supplierPaymentAccountId,
    customerId,
    supplierId,
    location: input.location?.trim() || null,
    description: input.description?.trim() || null,
    notes: input.notes?.trim() || null,
    metadata,
  };
}

export async function createFinancialDraft(rawInput: unknown, userId: string) {
  const input = financialDraftSchema.parse(rawInput);
  const [business] = await db.select().from(businesses).where(eq(businesses.id, input.businessId)).limit(1);
  if (!business) throw new ApiError("Business workspace was not found.", 404);
  const normalized = await normalizeFinancialDraft(input, business.baseCurrency);

  const inserted = await db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx
        .select()
        .from(financialTransactions)
        .where(and(eq(financialTransactions.businessId, input.businessId), eq(financialTransactions.idempotencyKey, input.idempotencyKey)))
        .limit(1);
      if (existing[0]) return existing[0];
    }
    const [transaction] = await tx
      .insert(financialTransactions)
      .values({
        businessId: input.businessId,
        kind: normalized.kind,
        status: "draft",
        transactionDate: normalized.transactionDate,
        quantity: normalized.quantity,
        tradedCurrency: normalized.tradedCurrency,
        settlementCurrency: normalized.settlementCurrency,
        rate: normalized.rate,
        baseRate: normalized.baseRate,
        grossAmount: normalized.grossAmount,
        fee: normalized.fee,
        totalAmount: normalized.totalAmount,
        costAmount: normalized.costAmount,
        paymentAmount: normalized.paymentAmount,
        paymentAccountId: normalized.paymentAccountId,
        supplierPaidAmount: normalized.supplierPaidAmount,
        supplierPaymentAccountId: normalized.supplierPaymentAccountId,
        customerId: normalized.customerId,
        supplierId: normalized.supplierId,
        location: normalized.location,
        description: normalized.description,
        notes: normalized.notes,
        metadata: normalized.metadata,
        idempotencyKey: input.idempotencyKey ?? null,
        creatorId: userId,
      })
      .returning();

    if (input.booking) {
      await tx.insert(bookings).values({
        businessId: input.businessId,
        transactionId: transaction.id,
        serviceType: input.booking.serviceType,
        bookingReference: input.booking.bookingReference || null,
        bookingStatus: input.booking.bookingStatus,
        customerId: normalized.customerId,
        supplierId: normalized.supplierId,
        passengerName: input.booking.passengerName || null,
        airlineName: input.booking.airlineName || null,
        origin: input.booking.origin || null,
        destination: input.booking.destination || null,
        travelDate: input.booking.travelDate ? new Date(input.booking.travelDate) : null,
        serviceDescription: input.booking.serviceDescription || null,
        currencyCode: normalized.settlementCurrency,
        saleAmount: normalized.totalAmount,
        costAmount: normalized.costAmount,
        paidAmount: normalized.paymentAmount,
        supplierPaidAmount: normalized.supplierPaidAmount,
        baseRate: normalized.baseRate,
        notes: normalized.notes,
        createdBy: userId,
      });
    }
    await tx.insert(auditLogs).values({
      businessId: input.businessId,
      userId,
      action: "draft.created",
      entityType: "financial_transaction",
      entityId: transaction.id,
      details: { kind: normalized.kind, totalAmount: normalized.totalAmount, currency: normalized.settlementCurrency },
    });
    return transaction;
  });
  return inserted;
}

export type InventorySnapshot = {
  currency: string;
  quantity: string;
  carryingValue: string;
  averageCost: string;
  baseCurrency: string;
};

export async function getInventorySnapshot(businessId: string, currency: string, baseCurrency: string): Promise<InventorySnapshot> {
  const rows = await db
    .select({
      quantity: sql<string>`coalesce(sum(${journalEntries.debit} - ${journalEntries.credit}), 0)::text`,
      carryingValue: sql<string>`coalesce(sum(${journalEntries.functionalDebit} - ${journalEntries.functionalCredit}), 0)::text`,
    })
    .from(journalEntries)
    .innerJoin(accounts, eq(journalEntries.accountId, accounts.id))
    .where(and(
      eq(journalEntries.businessId, businessId),
      eq(accounts.type, "inventory"),
      eq(accounts.currencyCode, currency.toUpperCase()),
    ));
  const quantity = parseDecimal(rows[0]?.quantity ?? "0");
  const carryingValue = parseDecimal(rows[0]?.carryingValue ?? "0");
  const averageCost = quantity > ZERO ? divide(carryingValue, quantity) : ZERO;
  return {
    currency: currency.toUpperCase(),
    quantity: decimalString(quantity),
    carryingValue: decimalString(carryingValue),
    averageCost: decimalString(averageCost),
    baseCurrency,
  };
}

export async function getCurrencyStock(businessId: string, baseCurrency: string) {
  const enabled = await db
    .select({ code: businessCurrencies.code, name: businessCurrencies.name })
    .from(businessCurrencies)
    .where(and(eq(businessCurrencies.businessId, businessId), eq(businessCurrencies.active, true)));
  const snapshots = await Promise.all(enabled.map((currency) => getInventorySnapshot(businessId, currency.code, baseCurrency)));
  return snapshots.filter((snapshot) => snapshot.quantity !== "0");
}
