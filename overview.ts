import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  auditLogs,
  bookings,
  businesses,
  customers,
  financialTransactions,
  journalEntries,
  memberships,
  receipts,
  suppliers,
  users,
} from "@/db/schema";
import { getCurrencyStock } from "@/lib/finance";
import { decimalString, parseDecimal } from "@/lib/decimal";

function startOfDayInTimezone(date: Date, timezone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const localAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
    const offset = localAsUtc - date.getTime();
    return new Date(Date.UTC(value("year"), value("month") - 1, value("day")) - offset);
  } catch {
    const start = new Date(date);
    start.setUTCHours(0, 0, 0, 0);
    return start;
  }
}

export async function accountBalances(businessId: string) {
  return db
    .select({
      id: accounts.id,
      name: accounts.name,
      code: accounts.code,
      type: accounts.type,
      currencyCode: accounts.currencyCode,
      active: accounts.active,
      isSystem: accounts.isSystem,
      balance: sql<string>`coalesce(sum(${journalEntries.debit} - ${journalEntries.credit}), 0)::text`,
      functionalBalance: sql<string>`coalesce(sum(${journalEntries.functionalDebit} - ${journalEntries.functionalCredit}), 0)::text`,
    })
    .from(accounts)
    .leftJoin(journalEntries, eq(journalEntries.accountId, accounts.id))
    .where(eq(accounts.businessId, businessId))
    .groupBy(accounts.id)
    .orderBy(accounts.isSystem, accounts.type, accounts.currencyCode, accounts.name);
}

export async function getDashboardOverview(business: typeof businesses.$inferSelect) {
  const todayStart = startOfDayInTimezone(new Date(), business.timezone);
  const tomorrow = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const [pendingRows, recent, totals, balances, stocks, customerCount, supplierCount, bookingCount] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(financialTransactions).where(and(
      eq(financialTransactions.businessId, business.id),
      eq(financialTransactions.status, "draft"),
    )),
    db.select().from(financialTransactions)
      .where(eq(financialTransactions.businessId, business.id))
      .orderBy(sql`${financialTransactions.createdAt} desc`)
      .limit(8),
    db.select({
      revenue: sql<string>`coalesce(sum(case when ${accounts.type} = 'income' then ${journalEntries.functionalCredit} - ${journalEntries.functionalDebit} else 0 end), 0)::text`,
      expenses: sql<string>`coalesce(sum(case when ${accounts.type} = 'expense' then ${journalEntries.functionalDebit} - ${journalEntries.functionalCredit} else 0 end), 0)::text`,
      gains: sql<string>`coalesce(sum(case when ${accounts.type} = 'fx_gain' then ${journalEntries.functionalCredit} - ${journalEntries.functionalDebit} else 0 end), 0)::text`,
      losses: sql<string>`coalesce(sum(case when ${accounts.type} = 'fx_loss' then ${journalEntries.functionalDebit} - ${journalEntries.functionalCredit} else 0 end), 0)::text`,
      cashFlow: sql<string>`coalesce(sum(case when ${accounts.type} in ('cash', 'bank') then ${journalEntries.functionalDebit} - ${journalEntries.functionalCredit} else 0 end), 0)::text`,
    })
      .from(journalEntries)
      .innerJoin(accounts, eq(journalEntries.accountId, accounts.id))
      .innerJoin(financialTransactions, eq(journalEntries.transactionId, financialTransactions.id))
      .where(and(
        eq(journalEntries.businessId, business.id),
        eq(financialTransactions.status, "posted"),
        gte(financialTransactions.transactionDate, todayStart),
        lt(financialTransactions.transactionDate, tomorrow),
      )),
    accountBalances(business.id),
    getCurrencyStock(business.id, business.baseCurrency),
    db.select({ count: sql<number>`count(*)::int` }).from(customers).where(eq(customers.businessId, business.id)),
    db.select({ count: sql<number>`count(*)::int` }).from(suppliers).where(eq(suppliers.businessId, business.id)),
    db.select({ count: sql<number>`count(*)::int` }).from(bookings).where(eq(bookings.businessId, business.id)),
  ]);

  const result = totals[0] ?? { revenue: "0", expenses: "0", gains: "0", losses: "0", cashFlow: "0" };
  const revenue = parseDecimal(result.revenue ?? "0");
  const expenses = parseDecimal(result.expenses ?? "0");
  const gains = parseDecimal(result.gains ?? "0");
  const losses = parseDecimal(result.losses ?? "0");
  return {
    business: {
      id: business.id,
      name: business.name,
      category: business.category,
      baseCurrency: business.baseCurrency,
      timezone: business.timezone,
      logoUrl: business.logoUrl,
      primaryColor: business.primaryColor,
      accentColor: business.accentColor,
    },
    today: {
      date: new Intl.DateTimeFormat("en-CA", { timeZone: business.timezone, dateStyle: "medium" }).format(new Date()),
      timezone: business.timezone,
      revenue: decimalString(revenue),
      expenses: decimalString(expenses),
      realizedExchangeGains: decimalString(gains),
      realizedExchangeLosses: decimalString(losses),
      netProfit: decimalString(revenue - expenses + gains - losses),
      cashFlow: result.cashFlow ?? "0",
      currency: business.baseCurrency,
    },
    pendingApprovals: pendingRows[0]?.count ?? 0,
    stocks,
    accounts: balances.filter((account) => !account.isSystem || ["cash", "bank"].includes(account.type)),
    receivables: balances.filter((account) => account.type === "receivable" && parseDecimal(account.balance ?? "0") > BigInt(0)),
    payables: balances.filter((account) => account.type === "payable" && parseDecimal(account.balance ?? "0") < BigInt(0)),
    counts: {
      customers: customerCount[0]?.count ?? 0,
      suppliers: supplierCount[0]?.count ?? 0,
      bookings: bookingCount[0]?.count ?? 0,
    },
    recentTransactions: recent,
  };
}

export async function getReport(business: typeof businesses.$inferSelect, from?: string, to?: string) {
  const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
  const toDate = to ? new Date(to) : new Date();
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    throw new Error("Report date range is invalid.");
  }
  const rows = await db
    .select({
      type: accounts.type,
      currency: journalEntries.currencyCode,
      debit: sql<string>`coalesce(sum(${journalEntries.debit}), 0)::text`,
      credit: sql<string>`coalesce(sum(${journalEntries.credit}), 0)::text`,
      functionalDebit: sql<string>`coalesce(sum(${journalEntries.functionalDebit}), 0)::text`,
      functionalCredit: sql<string>`coalesce(sum(${journalEntries.functionalCredit}), 0)::text`,
    })
    .from(journalEntries)
    .innerJoin(accounts, eq(journalEntries.accountId, accounts.id))
    .innerJoin(financialTransactions, eq(journalEntries.transactionId, financialTransactions.id))
    .where(and(
      eq(journalEntries.businessId, business.id),
      eq(financialTransactions.status, "posted"),
      gte(financialTransactions.transactionDate, fromDate),
      lt(financialTransactions.transactionDate, new Date(toDate.getTime() + 24 * 60 * 60 * 1000)),
    ))
    .groupBy(accounts.type, journalEntries.currencyCode);
  const totalsByType = (type: string, column: "functionalDebit" | "functionalCredit") =>
    rows.filter((row) => row.type === type).reduce((sum, row) => sum + parseDecimal(row[column] ?? "0"), BigInt(0));
  const sales = totalsByType("income", "functionalCredit") - totalsByType("income", "functionalDebit");
  const expenses = totalsByType("expense", "functionalDebit") - totalsByType("expense", "functionalCredit");
  const gains = totalsByType("fx_gain", "functionalCredit") - totalsByType("fx_gain", "functionalDebit");
  const losses = totalsByType("fx_loss", "functionalDebit") - totalsByType("fx_loss", "functionalCredit");
  const cashFlowByCurrency = rows
    .filter((row) => row.type === "cash" || row.type === "bank")
    .reduce<Record<string, string>>((acc, row) => {
      const amount = parseDecimal(row.debit ?? "0") - parseDecimal(row.credit ?? "0");
      acc[row.currency] = decimalString(parseDecimal(acc[row.currency] ?? "0") + amount);
      return acc;
    }, {});
  return {
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    reportingCurrency: business.baseCurrency,
    revenue: decimalString(sales),
    expenses: decimalString(expenses),
    realizedExchangeGains: decimalString(gains),
    realizedExchangeLosses: decimalString(losses),
    netProfit: decimalString(sales - expenses + gains - losses),
    cashFlowByCurrency,
    ledgerByCurrency: rows.map((row) => ({
      accountType: row.type,
      currency: row.currency,
      debit: row.debit,
      credit: row.credit,
      functionalDebit: row.functionalDebit,
      functionalCredit: row.functionalCredit,
    })),
  };
}

export async function getAuditTrail(businessId: string) {
  return db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      details: auditLogs.details,
      createdAt: auditLogs.createdAt,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.userId, users.id))
    .where(eq(auditLogs.businessId, businessId))
    .orderBy(sql`${auditLogs.createdAt} desc`)
    .limit(100);
}

export async function getWorkspaceReceipts(businessId: string) {
  return db
    .select({
      receipt: receipts,
      transaction: financialTransactions,
      customerName: customers.name,
    })
    .from(receipts)
    .innerJoin(financialTransactions, eq(receipts.transactionId, financialTransactions.id))
    .leftJoin(customers, eq(financialTransactions.customerId, customers.id))
    .where(eq(receipts.businessId, businessId))
    .orderBy(sql`${receipts.createdAt} desc`)
    .limit(100);
}

export async function businessMemberships(businessId: string) {
  return db
    .select({ membership: memberships, userName: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.businessId, businessId))
    .orderBy(users.name);
}
