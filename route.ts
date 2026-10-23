import { and, eq, ilike, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import {
  accounts,
  auditLogs,
  bookings,
  businessCurrencies,
  businesses,
  customers,
  financialTransactions,
  journalEntries,
  memberships,
  rateHistory,
  receipts,
  suppliers,
  users,
} from "@/db/schema";
import {
  ApiError,
  assertSameOrigin,
  createSession,
  currentUser,
  destroyCurrentSession,
  hashPassword,
  requireBusinessAccess,
  requireOwner,
  requireUser,
  verifyPassword,
} from "@/lib/auth";
import { runAssistant, assistantConfiguration } from "@/lib/assistant";
import { decimalString, parseDecimal } from "@/lib/decimal";
import { createFinancialDraft, getCurrencyStock, normalizeFinancialDraft } from "@/lib/finance";
import {
  accountBalances,
  businessMemberships,
  getAuditTrail,
  getDashboardOverview,
  getReport,
  getWorkspaceReceipts,
} from "@/lib/overview";
import { approveDraft, calculateDraftImpact, createReversalDraft, rejectDraft } from "@/lib/posting";
import {
  accountSchema,
  businessSchema,
  contactSchema,
  financialDraftSchema,
  settingsSchema,
  staffSchema,
} from "@/lib/validation";
import { CURRENCY_CATALOG, ensureBusinessDefaults, ensurePlatformSeeded } from "@/lib/workspace";

export const dynamic = "force-dynamic";
type JsonObject = Record<string, unknown>;

const setupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(180),
  password: z.string().min(12).max(200),
}).strict();
const loginSchema = z.object({ email: z.string().trim().email().max(180), password: z.string().min(1).max(200) }).strict();
const rateSchema = z.object({
  businessId: z.string().uuid(),
  baseCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3,8}$/),
  quoteCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3,8}$/),
  rate: z.string().trim().regex(/^\d+(?:\.\d{1,8})?$/),
  source: z.string().trim().min(3).max(100).default("owner-entered"),
}).strict();
const currencySchema = z.object({
  businessId: z.string().uuid(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{3,8}$/),
  name: z.string().trim().min(2).max(80),
  symbol: z.string().trim().min(1).max(12),
  decimalPlaces: z.number().int().min(0).max(8).default(2),
}).strict();

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status });
}

async function readBody(request: Request): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new ApiError("Request body must be valid JSON.", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("Request body must be a JSON object.", 400);
  return value as JsonObject;
}

function normalizeApiError(error: unknown) {
  if (error instanceof ApiError) return json({ error: error.message, details: error.details }, error.status);
  if (error instanceof z.ZodError) {
    return json({ error: "Request validation failed.", details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }, 400);
  }
  console.error("API request failed:", error);
  return json({ error: "The request could not be completed. Check your input and try again." }, 500);
}

async function businessIdFrom(request: Request, body?: JsonObject): Promise<string> {
  const url = new URL(request.url);
  const value = url.searchParams.get("businessId") ?? body?.businessId;
  if (typeof value !== "string" || !z.string().uuid().safeParse(value).success) throw new ApiError("A valid business workspace is required.", 400);
  return value;
}

/**
 * Reads the JSON body and guarantees the resolved business workspace is present.
 * The workspace may be supplied on the query string (how the client scopes reads)
 * or in the body, so write handlers accept either consistently.
 */
async function readScopedBody(request: Request): Promise<JsonObject> {
  const body = await readBody(request);
  if (!body.businessId) body.businessId = await businessIdFrom(request, body);
  return body;
}

function canCreate(access: Awaited<ReturnType<typeof requireBusinessAccess>>) {
  if (access.membership.role === "viewer") throw new ApiError("Your role can view this workspace but cannot create financial drafts.", 403);
  if (access.membership.role !== "owner" && access.membership.permissions?.create_transactions !== true) {
    throw new ApiError("Your role does not have permission to create financial drafts.", 403);
  }
}

function canManage(access: Awaited<ReturnType<typeof requireBusinessAccess>>, permission: string) {
  if (access.membership.role === "owner") return;
  if (access.membership.permissions?.[permission]) return;
  throw new ApiError("Your role does not have permission to manage this workspace section.", 403);
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "business";
}

async function getBusinessList(userId: string) {
  return db.select({ business: businesses, membership: memberships })
    .from(memberships)
    .innerJoin(businesses, eq(memberships.businessId, businesses.id))
    .where(eq(memberships.userId, userId))
    .orderBy(businesses.name);
}

async function contactBalances(businessId: string, contactId: string, kind: "customer" | "supplier") {
  const isCustomer = kind === "customer";
  const signedBalance = isCustomer
    ? sql`sum(${journalEntries.debit} - ${journalEntries.credit})`
    : sql`sum(${journalEntries.credit} - ${journalEntries.debit})`;
  return db.select({
    currency: journalEntries.currencyCode,
    balance: sql<string>`coalesce(${signedBalance}, 0)::text`,
  }).from(journalEntries)
    .innerJoin(accounts, eq(journalEntries.accountId, accounts.id))
    .where(and(
      eq(journalEntries.businessId, businessId),
      isCustomer ? eq(journalEntries.customerId, contactId) : eq(journalEntries.supplierId, contactId),
      eq(accounts.type, isCustomer ? "receivable" : "payable"),
    ))
    .groupBy(journalEntries.currencyCode);
}

async function contactHistory(businessId: string, contactId: string, kind: "customer" | "supplier") {
  return db.select({ transaction: financialTransactions, booking: bookings })
    .from(financialTransactions)
    .leftJoin(bookings, eq(bookings.transactionId, financialTransactions.id))
    .where(and(
      eq(financialTransactions.businessId, businessId),
      kind === "customer" ? eq(financialTransactions.customerId, contactId) : eq(financialTransactions.supplierId, contactId),
    ))
    .orderBy(sql`${financialTransactions.createdAt} desc`)
    .limit(100);
}

async function getPublicReceipt(transactionId: string, businessId: string, userId: string) {
  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  const rows = await db.select({ transaction: financialTransactions, customerName: customers.name, booking: bookings })
    .from(financialTransactions)
    .leftJoin(customers, eq(financialTransactions.customerId, customers.id))
    .leftJoin(bookings, eq(bookings.transactionId, financialTransactions.id))
    .where(and(eq(financialTransactions.id, transactionId), eq(financialTransactions.businessId, businessId)))
    .limit(1);
  const row = rows[0];
  if (!business || !row) throw new ApiError("Transaction or business workspace was not found.", 404);
  const transaction = row.transaction;
  if (transaction.status !== "posted" || !transaction.receiptNumber) throw new ApiError("A final receipt is only available after owner approval and posting.", 409);
  const existing = await db.select().from(receipts).where(eq(receipts.transactionId, transaction.id)).limit(1);
  if (!existing[0]) {
    await db.insert(receipts).values({
      businessId,
      transactionId: transaction.id,
      receiptNumber: transaction.receiptNumber,
      documentType: transaction.reversalOfId ? "reversal-receipt" : "final-transaction-receipt",
      createdBy: userId,
    }).onConflictDoNothing();
  }
  const [currency] = transaction.settlementCurrency
    ? await db.select().from(businessCurrencies).where(and(eq(businessCurrencies.businessId, businessId), eq(businessCurrencies.code, transaction.settlementCurrency))).limit(1)
    : [];
  const paid = parseDecimal(transaction.paymentAmount ?? "0");
  const total = parseDecimal(transaction.totalAmount ?? "0");
  const due = total - paid;
  const titleMap: Record<string, string> = {
    fx_purchase: "Currency purchase slip", fx_sale: "Currency exchange receipt", ticket: "Ticket service receipt",
    umrah: "Umrah service receipt", income: "Payment receipt", expense: "Expense record",
    customer_payment: "Customer payment receipt", supplier_payment: "Supplier payment record", reversal: "Reversal receipt",
  };
  const booking = row.booking;
  const document = {
    businessName: business.name,
    address: business.address,
    phone: business.phone,
    email: business.email,
    logoUrl: business.logoUrl,
    primaryColor: business.primaryColor,
    accentColor: business.accentColor,
    receiptNumber: transaction.receiptNumber,
    transactionDate: transaction.transactionDate,
    title: titleMap[transaction.kind] ?? "Transaction receipt",
    kind: transaction.kind,
    customerName: row.customerName ?? null,
    description: transaction.description,
    currency: transaction.settlementCurrency,
    currencySymbol: currency?.symbol ?? transaction.settlementCurrency,
    quantity: transaction.quantity,
    tradedCurrency: transaction.tradedCurrency,
    rate: transaction.rate,
    fee: transaction.fee,
    totalAmount: transaction.totalAmount,
    amountPaid: transaction.kind === "customer_payment" || transaction.kind === "supplier_payment" ? transaction.totalAmount : transaction.paymentAmount,
    amountOutstanding: transaction.kind === "customer_payment" || transaction.kind === "supplier_payment" ? "0" : decimalString(due),
    paymentStatus: transaction.kind === "customer_payment" || transaction.kind === "supplier_payment" ? "paid" : paid === BigInt(0) ? "unpaid" : due === BigInt(0) ? "paid" : "partial",
    booking: booking ? {
      serviceType: booking.serviceType,
      bookingReference: booking.bookingReference,
      status: booking.bookingStatus,
      passengerName: booking.passengerName,
      airlineName: booking.airlineName,
      origin: booking.origin,
      destination: booking.destination,
      travelDate: booking.travelDate,
      serviceDescription: booking.serviceDescription,
    } : null,
    terms: (business.settings as Record<string, unknown>)?.terms ?? null,
  };
  return { receipt: existing[0] ?? { receiptNumber: transaction.receiptNumber }, business, document };
}

async function updateDraft(transactionId: string, raw: JsonObject, userId: string, businessId: string) {
  const [existing] = await db.select().from(financialTransactions).where(and(eq(financialTransactions.id, transactionId), eq(financialTransactions.businessId, businessId))).limit(1);
  if (!existing) throw new ApiError("Draft was not found.", 404);
  if (existing.status !== "draft" || existing.kind === "reversal") throw new ApiError("Only an editable financial draft can be changed.", 409);
  const expectedVersion = Number(raw.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion !== existing.version) throw new ApiError("This draft changed in another session. Refresh and review it again.", 409, { currentVersion: existing.version });
  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!business) throw new ApiError("Business workspace was not found.", 404);
  const existingBooking = await db.select().from(bookings).where(eq(bookings.transactionId, existing.id)).limit(1);
  const suppliedBooking = raw.booking && typeof raw.booking === "object" ? raw.booking as JsonObject : {};
  const bookingValue = existingBooking[0] ? {
    serviceType: existingBooking[0].serviceType,
    bookingReference: existingBooking[0].bookingReference,
    bookingStatus: existingBooking[0].bookingStatus,
    passengerName: existingBooking[0].passengerName,
    airlineName: existingBooking[0].airlineName,
    origin: existingBooking[0].origin,
    destination: existingBooking[0].destination,
    travelDate: existingBooking[0].travelDate?.toISOString() ?? null,
    serviceDescription: existingBooking[0].serviceDescription,
    ...suppliedBooking,
  } : undefined;
  const candidate = financialDraftSchema.parse({
    businessId,
    kind: existing.kind,
    transactionDate: raw.transactionDate ?? existing.transactionDate.toISOString(),
    quantity: raw.quantity ?? existing.quantity ?? undefined,
    tradedCurrency: raw.tradedCurrency ?? existing.tradedCurrency ?? undefined,
    settlementCurrency: raw.settlementCurrency ?? existing.settlementCurrency ?? undefined,
    rate: raw.rate ?? existing.rate ?? undefined,
    baseRate: raw.baseRate ?? existing.baseRate ?? undefined,
    grossAmount: raw.grossAmount ?? existing.grossAmount ?? undefined,
    fee: raw.fee ?? existing.fee ?? "0",
    costAmount: raw.costAmount ?? existing.costAmount ?? "0",
    paymentAmount: raw.paymentAmount ?? existing.paymentAmount ?? "0",
    paymentAccountId: raw.paymentAccountId === undefined ? existing.paymentAccountId : raw.paymentAccountId,
    supplierPaidAmount: raw.supplierPaidAmount ?? existing.supplierPaidAmount ?? "0",
    supplierPaymentAccountId: raw.supplierPaymentAccountId === undefined ? existing.supplierPaymentAccountId : raw.supplierPaymentAccountId,
    customerId: raw.customerId === undefined ? existing.customerId : raw.customerId,
    supplierId: raw.supplierId === undefined ? existing.supplierId : raw.supplierId,
    location: raw.location === undefined ? existing.location : raw.location,
    description: raw.description === undefined ? existing.description : raw.description,
    notes: raw.notes === undefined ? existing.notes : raw.notes,
    idempotencyKey: existing.idempotencyKey ?? undefined,
    booking: bookingValue,
  });
  const normalized = await normalizeFinancialDraft(candidate, business.baseCurrency);
  return db.transaction(async (tx) => {
    const [result] = await tx.update(financialTransactions).set({
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
      version: sql`${financialTransactions.version} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(financialTransactions.id, transactionId),
      eq(financialTransactions.businessId, businessId),
      eq(financialTransactions.status, "draft"),
      eq(financialTransactions.version, expectedVersion),
    )).returning();
    if (!result) throw new ApiError("Draft changed while it was being saved. Refresh and try again.", 409);
    if (existingBooking[0] && candidate.booking) {
      await tx.update(bookings).set({
        bookingReference: candidate.booking.bookingReference || null,
        bookingStatus: candidate.booking.bookingStatus,
        passengerName: candidate.booking.passengerName || null,
        airlineName: candidate.booking.airlineName || null,
        origin: candidate.booking.origin || null,
        destination: candidate.booking.destination || null,
        travelDate: candidate.booking.travelDate ? new Date(candidate.booking.travelDate) : null,
        serviceDescription: candidate.booking.serviceDescription || null,
        customerId: normalized.customerId,
        supplierId: normalized.supplierId,
        currencyCode: normalized.settlementCurrency,
        saleAmount: normalized.totalAmount,
        costAmount: normalized.costAmount,
        paidAmount: normalized.paymentAmount,
        supplierPaidAmount: normalized.supplierPaidAmount,
        baseRate: normalized.baseRate,
        notes: normalized.notes,
        updatedAt: new Date(),
      }).where(eq(bookings.transactionId, transactionId));
    }
    await tx.insert(auditLogs).values({
      businessId,
      userId,
      action: "draft.updated",
      entityType: "financial_transaction",
      entityId: transactionId,
      details: { version: result.version, amount: result.totalAmount, currency: result.settlementCurrency },
    });
    return result;
  });
}

async function handle(request: Request, method: "GET" | "POST" | "PATCH" | "DELETE") {
  try {
    const url = new URL(request.url);
    const route = url.searchParams.get("route") ?? "";
    const segments = route.split("/").filter(Boolean);
    const path = segments.join("/");
    if (!route) throw new ApiError("Choose an API action using the route query parameter.", 400);
    if (method !== "GET") assertSameOrigin(request);

    if (method === "GET" && path === "auth/state") {
      await ensurePlatformSeeded();
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
      return json({ setupRequired: count === 0, ai: assistantConfiguration() });
    }

    if (method === "POST" && path === "auth/setup") {
      const input = setupSchema.parse(await readBody(request));
      await ensurePlatformSeeded();
      const email = input.email.toLowerCase();
      const user = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(71240718)`);
        const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(users);
        if (count > 0) throw new ApiError("Owner setup is already complete. Sign in with the existing account.", 409);
        const [created] = await tx.insert(users).values({ name: input.name, email, passwordHash: hashPassword(input.password) }).returning();
        const workspaces = await tx.select().from(businesses);
        if (workspaces.length === 0) throw new ApiError("Default business workspaces were not initialized.", 500);
        await tx.insert(memberships).values(workspaces.map((business) => ({
          userId: created.id,
          businessId: business.id,
          role: "owner",
          permissions: { create_transactions: true, manage_contacts: true, manage_bookings: true, manage_settings: true },
        })));
        await tx.insert(auditLogs).values({ userId: created.id, action: "owner.setup_completed", entityType: "user", entityId: created.id, details: { email } });
        return created;
      });
      await createSession(user.id);
      return json({ user: { id: user.id, name: user.name, email: user.email } }, 201);
    }

    if (method === "POST" && path === "auth/login") {
      const input = loginSchema.parse(await readBody(request));
      const [user] = await db.select().from(users).where(eq(users.email, input.email.toLowerCase())).limit(1);
      if (!user || !verifyPassword(input.password, user.passwordHash)) throw new ApiError("Email or password is incorrect.", 401);
      await createSession(user.id);
      await db.insert(auditLogs).values({ userId: user.id, action: "auth.login", entityType: "session", details: {} });
      return json({ user: { id: user.id, name: user.name, email: user.email, preferredLanguage: user.preferredLanguage } });
    }

    if (method === "POST" && path === "auth/logout") {
      const user = await currentUser();
      await destroyCurrentSession();
      if (user) await db.insert(auditLogs).values({ userId: user.id, action: "auth.logout", entityType: "session", details: {} });
      return json({ ok: true });
    }

    if (method === "POST" && path === "auth/recovery") {
      return json({ available: false, message: "Email recovery is not enabled because no verified email-delivery provider is configured. Ask the system administrator to configure a secure SMTP or transactional email service before requesting a reset." }, 503);
    }

    if (method === "GET" && path === "auth/me") {
      const user = await currentUser();
      if (!user) return json({ user: null, businesses: [] });
      const workspaces = await getBusinessList(user.id);
      return json({ user, businesses: workspaces.map((row) => ({ ...row.business, role: row.membership.role, permissions: row.membership.permissions })) });
    }

    if (method === "GET" && path === "assistant/config") return json(assistantConfiguration());

    if (method === "GET" && path === "businesses") {
      const user = await requireUser();
      const workspaces = await getBusinessList(user.id);
      return json({ businesses: workspaces.map((row) => ({ ...row.business, role: row.membership.role, permissions: row.membership.permissions })) });
    }

    if (method === "POST" && path === "businesses") {
      const user = await requireUser();
      const input = businessSchema.parse(await readBody(request));
      const owned = await db.select().from(memberships).where(and(eq(memberships.userId, user.id), eq(memberships.role, "owner"))).limit(1);
      if (!owned[0]) throw new ApiError("Only a business owner can add another workspace.", 403);
      if (!CURRENCY_CATALOG.some((currency) => currency.code === input.baseCurrency)) throw new ApiError("Choose an enabled currency code from the currency settings.");
      const [business] = await db.insert(businesses).values({
        name: input.name,
        slug: `${slugify(input.name)}-${randomUUID().slice(0, 6)}`,
        category: input.category,
        baseCurrency: input.baseCurrency,
        timezone: input.timezone,
        primaryColor: input.category === "travel_agency" ? "#123c3c" : "#13243d",
        accentColor: input.category === "travel_agency" ? "#d2b679" : "#c9a66b",
      }).returning();
      await ensureBusinessDefaults(business.id, business.baseCurrency);
      await db.insert(memberships).values({ userId: user.id, businessId: business.id, role: "owner", permissions: { create_transactions: true, manage_contacts: true, manage_bookings: true, manage_settings: true } });
      await db.insert(auditLogs).values({ businessId: business.id, userId: user.id, action: "business.created", entityType: "business", entityId: business.id, details: { name: business.name } });
      return json({ business }, 201);
    }

    if (method === "PATCH" && segments[0] === "businesses" && segments[1]) {
      const user = await requireUser();
      const businessId = segments[1];
      const access = await requireBusinessAccess(businessId, user);
      requireOwner(access);
      const input = settingsSchema.parse(await readBody(request));
      const [currency] = await db.select().from(businessCurrencies).where(and(eq(businessCurrencies.businessId, businessId), eq(businessCurrencies.code, input.baseCurrency), eq(businessCurrencies.active, true))).limit(1);
      if (!currency) throw new ApiError("The reporting currency must be enabled in this workspace.");
      if (input.baseCurrency !== access.business.baseCurrency) {
        const [postedCount] = await db.select({ count: sql<number>`count(*)::int` }).from(financialTransactions).where(and(eq(financialTransactions.businessId, businessId), eq(financialTransactions.status, "posted")));
        if (postedCount.count > 0) throw new ApiError("The reporting currency cannot change after financial postings exist; historical ledger basis must remain unchanged.", 409);
      }
      if (input.logoUrl && !input.logoUrl.startsWith("/") && !/^https:\/\//i.test(input.logoUrl)) throw new ApiError("Logo URL must be a local path or a secure HTTPS URL.");
      const previousSettings = (access.business.settings ?? {}) as Record<string, unknown>;
      const [business] = await db.update(businesses).set({
        name: input.name, baseCurrency: input.baseCurrency, timezone: input.timezone,
        address: input.address || null, phone: input.phone || null, email: input.email || null,
        logoUrl: input.logoUrl || null, primaryColor: input.primaryColor, accentColor: input.accentColor,
        settings: { ...previousSettings, terms: input.terms || null }, updatedAt: new Date(),
      }).where(eq(businesses.id, businessId)).returning();
      await db.insert(auditLogs).values({ businessId, userId: user.id, action: "business.settings_updated", entityType: "business", entityId: businessId, details: { changed: ["identity", "brand", "contact", "reporting"] } });
      return json({ business });
    }

    if (method === "GET" && path === "reports/consolidated") {
      const user = await requireUser();
      const owned = await db.select({ business: businesses }).from(memberships).innerJoin(businesses, eq(memberships.businessId, businesses.id)).where(and(eq(memberships.userId, user.id), eq(memberships.role, "owner")));
      if (owned.length < 2) throw new ApiError("A combined report is available only to an owner with at least two workspaces.", 403);
      const reports = await Promise.all(owned.map(({ business }) => getReport(business, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined)));
      return json({ policy: "Each workspace remains in its own reporting currency. Cross-currency totals are never added without an explicit conversion rate.", reports: reports.map((report, index) => ({ business: owned[index].business.name, ...report })) });
    }

    if (method === "GET" && path === "overview") {
      const user = await requireUser();
      const businessId = await businessIdFrom(request);
      const access = await requireBusinessAccess(businessId, user);
      return json(await getDashboardOverview(access.business));
    }

    if (method === "GET" && path === "reports") {
      const user = await requireUser();
      const businessId = await businessIdFrom(request);
      const access = await requireBusinessAccess(businessId, user);
      return json(await getReport(access.business, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined));
    }

    if (method === "GET" && path === "transactions") {
      const user = await requireUser();
      const businessId = await businessIdFrom(request);
      await requireBusinessAccess(businessId, user);
      const status = url.searchParams.get("status");
      const query = url.searchParams.get("q")?.trim();
      const conditions = [eq(financialTransactions.businessId, businessId)];
      if (status) conditions.push(eq(financialTransactions.status, status));
      if (query) conditions.push(or(
        ilike(financialTransactions.description, `%${query}%`),
        ilike(financialTransactions.notes, `%${query}%`),
        ilike(financialTransactions.receiptNumber, `%${query}%`),
        ilike(financialTransactions.location, `%${query}%`),
      )!);
      const rows = await db.select({ transaction: financialTransactions, customerName: customers.name, supplierName: suppliers.name })
        .from(financialTransactions)
        .leftJoin(customers, eq(financialTransactions.customerId, customers.id))
        .leftJoin(suppliers, eq(financialTransactions.supplierId, suppliers.id))
        .where(and(...conditions))
        .orderBy(sql`${financialTransactions.createdAt} desc`)
        .limit(200);
      return json({ transactions: rows });
    }

    if (method === "GET" && segments[0] === "transactions" && segments[1]) {
      const user = await requireUser();
      const businessId = await businessIdFrom(request);
      await requireBusinessAccess(businessId, user);
      const rows = await db.select({ transaction: financialTransactions, customerName: customers.name, supplierName: suppliers.name, booking: bookings })
        .from(financialTransactions)
        .leftJoin(customers, eq(financialTransactions.customerId, customers.id))
        .leftJoin(suppliers, eq(financialTransactions.supplierId, suppliers.id))
        .leftJoin(bookings, eq(bookings.transactionId, financialTransactions.id))
        .where(and(eq(financialTransactions.businessId, businessId), eq(financialTransactions.id, segments[1])))
        .limit(1);
      if (!rows[0]) throw new ApiError("Transaction was not found.", 404);
      const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
      const impact = rows[0].transaction.status === "draft" ? await calculateDraftImpact(rows[0].transaction, business.baseCurrency) : null;
      return json({ ...rows[0], impact });
    }

    if (method === "GET" && path === "accounts") {
      const user = await requireUser();
      const businessId = await businessIdFrom(request);
      const access = await requireBusinessAccess(businessId, user);
      return json({ accounts: await accountBalances(businessId), canApprove: access.membership.role === "owner" });
    }

    if (method === "GET" && (path === "customers" || path === "suppliers")) {
      const user = await requireUser();
      const businessId = await businessIdFrom(request);
      await requireBusinessAccess(businessId, user);
      const contactId = url.searchParams.get("id");
      const kind = path === "customers" ? "customer" : "supplier";
      if (contactId) {
        if (kind === "customer") {
          const [contact] = await db.select().from(customers).where(and(eq(customers.id, contactId), eq(customers.businessId, businessId))).limit(1);
          if (!contact) throw new ApiError("Customer was not found.", 404);
          return json({ contact, balances: await contactBalances(businessId, contact.id, kind), history: await contactHistory(businessId, contact.id, kind) });
        }
        const [contact] = await db.select().from(suppliers).where(and(eq(suppliers.id, contactId), eq(suppliers.businessId, businessId))).limit(1);
        if (!contact) throw new ApiError("Supplier was not found.", 404);
        return json({ contact, balances: await contactBalances(businessId, contact.id, kind), history: await contactHistory(businessId, contact.id, kind) });
      }
      const query = url.searchParams.get("q")?.trim();
      if (kind === "customer") {
        const list = await db.select().from(customers).where(and(eq(customers.businessId, businessId), query ? or(ilike(customers.name, `%${query}%`), ilike(customers.phone, `%${query}%`), ilike(customers.email, `%${query}%`))! : sql`true`)).orderBy(customers.name).limit(300);
        return json({ contacts: list });
      }
      const list = await db.select().from(suppliers).where(and(eq(suppliers.businessId, businessId), query ? or(ilike(suppliers.name, `%${query}%`), ilike(suppliers.phone, `%${query}%`), ilike(suppliers.email, `%${query}%`))! : sql`true`)).orderBy(suppliers.name).limit(300);
      return json({ contacts: list });
    }

    if (method === "GET" && path === "bookings") {
      const user = await requireUser();
      const businessId = await businessIdFrom(request);
      await requireBusinessAccess(businessId, user);
      const rows = await db.select({ booking: bookings, transaction: financialTransactions, customerName: customers.name, supplierName: suppliers.name })
        .from(bookings)
        .innerJoin(financialTransactions, eq(bookings.transactionId, financialTransactions.id))
        .leftJoin(customers, eq(bookings.customerId, customers.id))
        .leftJoin(suppliers, eq(bookings.supplierId, suppliers.id))
        .where(eq(bookings.businessId, businessId))
        .orderBy(sql`${bookings.createdAt} desc`)
        .limit(200);
      return json({ bookings: rows });
    }

    if (method === "GET" && path === "receipts") {
      const user = await requireUser();
      const businessId = await businessIdFrom(request);
      await requireBusinessAccess(businessId, user);
      return json({ receipts: await getWorkspaceReceipts(businessId) });
    }

    if (method === "GET" && path === "audit") {
      const user = await requireUser();
      const businessId = await businessIdFrom(request);
      await requireBusinessAccess(businessId, user);
      return json({ events: await getAuditTrail(businessId) });
    }

    if (method === "GET" && path === "staff") {
      const user = await requireUser();
      const businessId = await businessIdFrom(request);
      const access = await requireBusinessAccess(businessId, user);
      return json({ staff: await businessMemberships(businessId), canManage: access.membership.role === "owner" });
    }

    if (method === "GET" && path === "currencies") {
      const user = await requireUser();
      const businessId = await businessIdFrom(request);
      const access = await requireBusinessAccess(businessId, user);
      const currencies = await db.select().from(businessCurrencies).where(eq(businessCurrencies.businessId, businessId)).orderBy(businessCurrencies.code);
      return json({ currencies, baseCurrency: access.business.baseCurrency });
    }

    if (method === "GET" && path === "rates") {
      const user = await requireUser();
      const businessId = await businessIdFrom(request);
      await requireBusinessAccess(businessId, user);
      const rates = await db.select({ rate: rateHistory, enteredByName: users.name }).from(rateHistory)
        .leftJoin(users, eq(rateHistory.enteredBy, users.id))
        .where(eq(rateHistory.businessId, businessId))
        .orderBy(sql`${rateHistory.capturedAt} desc`)
        .limit(200);
      return json({ rates });
    }

    if (method === "GET" && path === "notifications") {
      const user = await requireUser();
      const businessId = await businessIdFrom(request);
      await requireBusinessAccess(businessId, user);
      const [pending] = await db.select({ count: sql<number>`count(*)::int` }).from(financialTransactions).where(and(eq(financialTransactions.businessId, businessId), eq(financialTransactions.status, "draft")));
      const events = await getAuditTrail(businessId);
      return json({ pendingApprovals: pending.count, recentEvents: events.slice(0, 12) });
    }

    if (method === "GET" && path === "currencies/stock") {
      const user = await requireUser();
      const businessId = await businessIdFrom(request);
      const access = await requireBusinessAccess(businessId, user);
      return json({ stock: await getCurrencyStock(businessId, access.business.baseCurrency) });
    }

    if (method === "POST" && path === "transactions") {
      const user = await requireUser();
      const body = await readBody(request);
      const businessId = await businessIdFrom(request, body);
      const access = await requireBusinessAccess(businessId, user);
      canCreate(access);
      const transaction = await createFinancialDraft({ ...body, businessId }, user.id);
      return json({ transaction, impact: await calculateDraftImpact(transaction, access.business.baseCurrency) }, 201);
    }

    if (method === "POST" && segments[0] === "transactions" && segments[1] && segments[2] === "approve") {
      const user = await requireUser();
      const body = await readBody(request);
      const businessId = await businessIdFrom(request, body);
      const access = await requireBusinessAccess(businessId, user);
      requireOwner(access);
      const expectedVersion = z.number().int().positive().parse(body.expectedVersion);
      return json({ transaction: await approveDraft(segments[1], businessId, user.id, expectedVersion) });
    }

    if (method === "POST" && segments[0] === "transactions" && segments[1] && segments[2] === "reject") {
      const user = await requireUser();
      const body = await readBody(request);
      const businessId = await businessIdFrom(request, body);
      const access = await requireBusinessAccess(businessId, user);
      requireOwner(access);
      const version = z.number().int().positive().parse(body.expectedVersion);
      const reason = typeof body.reason === "string" ? body.reason : "Rejected by owner";
      return json({ transaction: await rejectDraft(segments[1], businessId, user.id, version, reason) });
    }

    if (method === "POST" && segments[0] === "transactions" && segments[1] && segments[2] === "reverse") {
      const user = await requireUser();
      const body = await readBody(request);
      const businessId = await businessIdFrom(request, body);
      const access = await requireBusinessAccess(businessId, user);
      requireOwner(access);
      return json({ transaction: await createReversalDraft(segments[1], businessId, user.id) }, 201);
    }

    if (method === "PATCH" && segments[0] === "transactions" && segments[1]) {
      const user = await requireUser();
      const body = await readBody(request);
      const businessId = await businessIdFrom(request, body);
      const access = await requireBusinessAccess(businessId, user);
      canCreate(access);
      return json({ transaction: await updateDraft(segments[1], body, user.id, businessId) });
    }

    if (method === "POST" && (path === "customers" || path === "suppliers")) {
      const user = await requireUser();
      const parsed = contactSchema.parse(await readScopedBody(request));
      const access = await requireBusinessAccess(parsed.businessId, user);
      canManage(access, "manage_contacts");
      const table = path === "customers" ? customers : suppliers;
      const [contact] = await db.insert(table).values({
        businessId: parsed.businessId, name: parsed.name, phone: parsed.phone || null,
        email: parsed.email || null, notes: parsed.notes || null,
      }).returning();
      await db.insert(auditLogs).values({ businessId: parsed.businessId, userId: user.id, action: `${path.slice(0, -1)}.created`, entityType: path.slice(0, -1), entityId: contact.id, details: { name: contact.name } });
      return json({ contact }, 201);
    }

    if (method === "POST" && path === "bookings") {
      const user = await requireUser();
      const input = financialDraftSchema.parse(await readScopedBody(request));
      if (input.kind !== "ticket" && input.kind !== "umrah") throw new ApiError("Booking type must be ticket or Umrah.");
      const access = await requireBusinessAccess(input.businessId, user);
      canManage(access, "manage_bookings");
      const transaction = await createFinancialDraft(input, user.id);
      const [booking] = await db.select().from(bookings).where(eq(bookings.transactionId, transaction.id)).limit(1);
      return json({ booking, transaction, impact: await calculateDraftImpact(transaction, access.business.baseCurrency) }, 201);
    }

    if (method === "PATCH" && segments[0] === "bookings" && segments[1]) {
      const user = await requireUser();
      const body = await readBody(request);
      const businessId = await businessIdFrom(request, body);
      const access = await requireBusinessAccess(businessId, user);
      canManage(access, "manage_bookings");
      const status = z.enum(["quotation", "reserved", "issued", "paid", "cancelled"]).parse(body.bookingStatus);
      const rows = await db.select({ booking: bookings, transaction: financialTransactions }).from(bookings)
        .innerJoin(financialTransactions, eq(bookings.transactionId, financialTransactions.id))
        .where(and(eq(bookings.id, segments[1]), eq(bookings.businessId, businessId))).limit(1);
      const row = rows[0];
      if (!row) throw new ApiError("Booking was not found.", 404);
      if (status === "paid" && (row.transaction.status !== "posted" || parseDecimal(row.transaction.paymentAmount) !== parseDecimal(row.transaction.totalAmount))) {
        throw new ApiError("A booking cannot be marked paid until its posted customer balance is fully received.", 409);
      }
      const [booking] = await db.update(bookings).set({ bookingStatus: status, updatedAt: new Date() }).where(eq(bookings.id, segments[1])).returning();
      await db.insert(auditLogs).values({ businessId, userId: user.id, action: "booking.status_updated", entityType: "booking", entityId: booking.id, details: { status } });
      return json({ booking });
    }

    if (method === "POST" && path === "accounts") {
      const user = await requireUser();
      const input = accountSchema.parse(await readScopedBody(request));
      const access = await requireBusinessAccess(input.businessId, user);
      canManage(access, "manage_settings");
      const [currency] = await db.select().from(businessCurrencies).where(and(eq(businessCurrencies.businessId, input.businessId), eq(businessCurrencies.code, input.currencyCode), eq(businessCurrencies.active, true))).limit(1);
      if (!currency) throw new ApiError("Enable this currency in currency settings first.");
      const code = `MANUAL_${input.type.toUpperCase()}_${input.currencyCode}_${randomUUID().slice(0, 6).toUpperCase()}`;
      const [account] = await db.insert(accounts).values({ businessId: input.businessId, code, name: input.name, type: input.type, currencyCode: input.currencyCode }).returning();
      await db.insert(auditLogs).values({ businessId: input.businessId, userId: user.id, action: "account.created", entityType: "account", entityId: account.id, details: { name: account.name, currency: account.currencyCode } });
      return json({ account }, 201);
    }

    if (method === "POST" && path === "currencies") {
      const user = await requireUser();
      const input = currencySchema.parse(await readScopedBody(request));
      const access = await requireBusinessAccess(input.businessId, user);
      requireOwner(access);
      const [currency] = await db.insert(businessCurrencies).values(input).onConflictDoNothing().returning();
      if (!currency) throw new ApiError("This currency is already enabled in the workspace.", 409);
      const types = ["cash", "bank", "inventory", "receivable", "payable", "income", "expense", "fx_gain", "fx_loss"];
      const accountValues = types.map((type) => ({
        businessId: input.businessId,
        code: `${type}_${input.code}`.toUpperCase(),
        name: `${type.replaceAll("_", " ")} · ${input.code}`,
        type,
        currencyCode: input.code,
        isSystem: !["cash", "bank"].includes(type),
      }));
      await db.insert(accounts).values(accountValues).onConflictDoNothing();
      await db.insert(auditLogs).values({ businessId: input.businessId, userId: user.id, action: "currency.enabled", entityType: "currency", entityId: currency.id, details: { code: input.code } });
      return json({ currency }, 201);
    }

    if (method === "POST" && path === "rates") {
      const user = await requireUser();
      const input = rateSchema.parse(await readScopedBody(request));
      const access = await requireBusinessAccess(input.businessId, user);
      requireOwner(access);
      if (input.baseCurrency === input.quoteCurrency) throw new ApiError("Choose two different currencies for a rate pair.");
      for (const code of [input.baseCurrency, input.quoteCurrency]) {
        const [enabled] = await db.select().from(businessCurrencies).where(and(eq(businessCurrencies.businessId, input.businessId), eq(businessCurrencies.code, code), eq(businessCurrencies.active, true))).limit(1);
        if (!enabled) throw new ApiError(`${code} is not enabled for this business.`);
      }
      if (parseDecimal(input.rate) <= BigInt(0)) throw new ApiError("Rate must be greater than zero.");
      const [rate] = await db.insert(rateHistory).values({ ...input, enteredBy: user.id }).returning();
      await db.insert(auditLogs).values({ businessId: input.businessId, userId: user.id, action: "rate.owner_entered", entityType: "exchange_rate", entityId: rate.id, details: { pair: `${rate.baseCurrency}/${rate.quoteCurrency}`, rate: rate.rate, source: rate.source } });
      return json({ rate }, 201);
    }

    if (method === "POST" && path === "staff") {
      const user = await requireUser();
      const input = staffSchema.parse(await readScopedBody(request));
      const access = await requireBusinessAccess(input.businessId, user);
      requireOwner(access);
      const [target] = await db.select().from(users).where(eq(users.email, input.email.toLowerCase())).limit(1);
      if (!target) throw new ApiError("That account does not exist yet. Email invitations require a verified mail provider; ask the person to complete account setup first.", 404);
      if (target.id === user.id) throw new ApiError("You already own this workspace.");
      const permissions = {
        create_transactions: input.role !== "viewer",
        manage_contacts: input.role === "manager" || input.role === "staff",
        manage_bookings: input.role === "manager" || input.role === "staff",
        manage_settings: false,
        approve_financial: false,
      };
      const [membership] = await db.insert(memberships).values({ userId: target.id, businessId: input.businessId, role: input.role, permissions })
        .onConflictDoUpdate({ target: [memberships.userId, memberships.businessId], set: { role: input.role, permissions } })
        .returning();
      await db.insert(auditLogs).values({ businessId: input.businessId, userId: user.id, action: "staff.access_granted", entityType: "membership", entityId: membership.id, details: { email: target.email, role: input.role } });
      return json({ membership }, 201);
    }

    if (method === "POST" && path === "assistant") {
      const user = await requireUser();
      const body = await readBody(request);
      const businessId = await businessIdFrom(request, body);
      const access = await requireBusinessAccess(businessId, user);
      return json(await runAssistant(body.message, access.business, user));
    }

    if (method === "POST" && path === "receipts") {
      const user = await requireUser();
      const body = await readBody(request);
      const businessId = await businessIdFrom(request, body);
      await requireBusinessAccess(businessId, user);
      const transactionId = z.string().uuid().parse(body.transactionId);
      return json(await getPublicReceipt(transactionId, businessId, user.id));
    }

    if (method === "PATCH" && segments[0] === "staff" && segments[1]) {
      const user = await requireUser();
      const body = await readBody(request);
      const businessId = await businessIdFrom(request, body);
      const access = await requireBusinessAccess(businessId, user);
      requireOwner(access);
      const role = z.enum(["manager", "staff", "viewer"]).parse(body.role);
      const [membership] = await db.update(memberships).set({
        role,
        permissions: { create_transactions: role !== "viewer", manage_contacts: role === "manager" || role === "staff", manage_bookings: role === "manager" || role === "staff", manage_settings: false, approve_financial: false },
      }).where(and(eq(memberships.id, segments[1]), eq(memberships.businessId, businessId))).returning();
      if (!membership) throw new ApiError("Workspace membership was not found.", 404);
      await db.insert(auditLogs).values({ businessId, userId: user.id, action: "staff.role_updated", entityType: "membership", entityId: membership.id, details: { role } });
      return json({ membership });
    }

    if (method === "DELETE" && segments[0] === "staff" && segments[1]) {
      const user = await requireUser();
      const businessId = url.searchParams.get("businessId");
      if (!businessId) throw new ApiError("A valid business workspace is required.", 400);
      const access = await requireBusinessAccess(businessId, user);
      requireOwner(access);
      const [target] = await db.select().from(memberships).where(and(eq(memberships.id, segments[1]), eq(memberships.businessId, businessId))).limit(1);
      if (!target) throw new ApiError("Workspace membership was not found.", 404);
      if (target.role === "owner") throw new ApiError("Owner access cannot be removed from this screen.", 409);
      await db.delete(memberships).where(eq(memberships.id, target.id));
      await db.insert(auditLogs).values({ businessId, userId: user.id, action: "staff.access_removed", entityType: "membership", entityId: target.id, details: {} });
      return json({ ok: true });
    }

    return json({ error: "This API action was not found." }, 404);
  } catch (error) {
    return normalizeApiError(error);
  }
}

export async function GET(request: Request) {
  return handle(request, "GET");
}
export async function POST(request: Request) {
  return handle(request, "POST");
}
export async function PATCH(request: Request) {
  return handle(request, "PATCH");
}
export async function DELETE(request: Request) {
  return handle(request, "DELETE");
}
