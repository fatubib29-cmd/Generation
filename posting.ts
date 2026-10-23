import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  auditLogs,
  businesses,
  financialTransactions,
  journalEntries,
  receipts,
} from "@/db/schema";
import { ApiError } from "@/lib/auth";
import { add, decimalString, divide, multiply, parseDecimal, roundTo } from "@/lib/decimal";
import { getInventorySnapshot } from "@/lib/finance";

const ZERO = BigInt(0);
const SCALE_ONE = BigInt(100_000_000);

type JournalLine = {
  accountId: string;
  customerId?: string | null;
  supplierId?: string | null;
  currencyCode: string;
  debit: bigint;
  credit: bigint;
  functionalDebit: bigint;
  functionalCredit: bigint;
  description: string;
};

function units(value: string | number | null | undefined, label = "Amount"): bigint {
  return parseDecimal(value == null ? "0" : String(value), label);
}

function amountToBase(amount: bigint, factor: bigint, decimalPlaces: number): bigint {
  return roundTo(multiply(amount, factor), decimalPlaces);
}

async function accountFor(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  businessId: string,
  type: string,
  currency: string,
) {
  const rows = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.businessId, businessId), eq(accounts.type, type), eq(accounts.currencyCode, currency), eq(accounts.active, true)))
    .limit(1);
  if (!rows[0]) throw new ApiError(`A ${type.replaceAll("_", " ")} ledger account for ${currency} is not configured.`, 409);
  return rows[0];
}

function addLine(lines: JournalLine[], line: JournalLine): void {
  if (line.debit === ZERO && line.credit === ZERO && line.functionalDebit === ZERO && line.functionalCredit === ZERO) return;
  lines.push(line);
}

function ensureBalanced(lines: JournalLine[]): void {
  const debits = lines.reduce((sum, line) => sum + line.functionalDebit, ZERO);
  const credits = lines.reduce((sum, line) => sum + line.functionalCredit, ZERO);
  if (debits !== credits) {
    throw new ApiError("The calculated journal does not balance in the business reporting currency; nothing was posted.", 409, {
      debits: decimalString(debits),
      credits: decimalString(credits),
    });
  }
}

async function inventoryPosition(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  businessId: string,
  currency: string,
) {
  const rows = await tx
    .select({
      quantity: sql<string>`coalesce(sum(${journalEntries.debit} - ${journalEntries.credit}), 0)::text`,
      value: sql<string>`coalesce(sum(${journalEntries.functionalDebit} - ${journalEntries.functionalCredit}), 0)::text`,
    })
    .from(journalEntries)
    .innerJoin(accounts, eq(journalEntries.accountId, accounts.id))
    .where(and(
      eq(journalEntries.businessId, businessId),
      eq(accounts.type, "inventory"),
      eq(accounts.currencyCode, currency),
    ));
  return {
    quantity: units(rows[0]?.quantity ?? "0"),
    value: units(rows[0]?.value ?? "0"),
  };
}

async function buildJournal(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  transaction: typeof financialTransactions.$inferSelect,
  business: typeof businesses.$inferSelect,
): Promise<{ lines: JournalLine[]; costAmount: string }> {
  const lines: JournalLine[] = [];
  const basePlaces = 2;
  const transactionCurrency = transaction.settlementCurrency;
  if (!transactionCurrency) throw new ApiError("The transaction has no settlement currency.", 409);
  const factor = transaction.baseRate ? units(transaction.baseRate, "Reporting-currency rate") : (transactionCurrency === business.baseCurrency ? SCALE_ONE : ZERO);
  if (factor <= ZERO) {
    throw new ApiError(`An owner-entered ${transactionCurrency} to ${business.baseCurrency} reporting rate is required before approval.`);
  }
  const currencyBaseAmount = (value: bigint) => amountToBase(value, factor, basePlaces);
  const total = units(transaction.totalAmount, "Transaction total");
  const paid = units(transaction.paymentAmount, "Amount paid");
  const due = total - paid;
  if (total <= ZERO || paid < ZERO || due < ZERO) throw new ApiError("Transaction totals or payment amounts are invalid.", 409);

  const cashAccount = async (accountId: string | null, currency: string, label: string) => {
    if (!accountId) return null;
    const rows = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.businessId, business.id), eq(accounts.active, true)))
      .limit(1);
    const account = rows[0];
    if (!account || (account.type !== "cash" && account.type !== "bank") || account.currencyCode !== currency) {
      throw new ApiError(`${label} account is no longer valid for ${currency}.`, 409);
    }
    return account;
  };

  if (transaction.kind === "fx_purchase") {
    const tradedCurrency = transaction.tradedCurrency;
    if (!tradedCurrency || !transaction.quantity || !transaction.rate) throw new ApiError("Currency purchase details are incomplete.", 409);
    const supplier = transaction.supplierId;
    if (due > ZERO && !supplier) throw new ApiError("Select a supplier for the unpaid purchase balance, or record a fully paid purchase.");
    const inventory = await accountFor(tx, business.id, "inventory", tradedCurrency);
    addLine(lines, {
      accountId: inventory.id,
      currencyCode: tradedCurrency,
      debit: units(transaction.quantity, "Quantity"), credit: ZERO,
      functionalDebit: currencyBaseAmount(total), functionalCredit: ZERO,
      description: "Currency inventory acquired at weighted-average cost",
    });
    if (paid > ZERO) {
      const cash = await cashAccount(transaction.paymentAccountId, transactionCurrency, "Purchase payment");
      if (!cash) throw new ApiError("Choose a cash or bank account for the paid amount.");
      addLine(lines, {
        accountId: cash.id, currencyCode: transactionCurrency, debit: ZERO, credit: paid,
        functionalDebit: ZERO, functionalCredit: currencyBaseAmount(paid), description: "Currency purchase payment",
      });
    }
    if (due > ZERO) {
      const payable = await accountFor(tx, business.id, "payable", transactionCurrency);
      addLine(lines, {
        accountId: payable.id, supplierId: transaction.supplierId, currencyCode: transactionCurrency, debit: ZERO, credit: due,
        functionalDebit: ZERO, functionalCredit: currencyBaseAmount(total) - currencyBaseAmount(paid),
        description: "Unpaid currency purchase payable",
      });
    }
    return { lines, costAmount: decimalString(currencyBaseAmount(total)) };
  }

  if (transaction.kind === "fx_sale") {
    const tradedCurrency = transaction.tradedCurrency;
    if (!tradedCurrency || !transaction.quantity || !transaction.rate) throw new ApiError("Currency sale details are incomplete.", 409);
    if (due > ZERO && !transaction.customerId) throw new ApiError("Select a customer for the unpaid sale balance, or record the full amount received.");
    const inventory = await accountFor(tx, business.id, "inventory", tradedCurrency);
    await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, inventory.id)).for("update");
    const position = await inventoryPosition(tx, business.id, tradedCurrency);
    const quantity = units(transaction.quantity, "Quantity");
    if (position.quantity <= ZERO || quantity > position.quantity) {
      throw new ApiError(`Insufficient ${tradedCurrency} inventory. Available: ${decimalString(position.quantity)} ${tradedCurrency}. No negative stock was posted.`, 409);
    }
    const cost = quantity === position.quantity
      ? position.value
      : roundTo(multiply(quantity, divide(position.value, position.quantity)), basePlaces);
    if (paid > ZERO) {
      const cash = await cashAccount(transaction.paymentAccountId, transactionCurrency, "Sale receipt");
      if (!cash) throw new ApiError("Choose the cash or bank account where the received amount was deposited.");
      addLine(lines, {
        accountId: cash.id, currencyCode: transactionCurrency, debit: paid, credit: ZERO,
        functionalDebit: currencyBaseAmount(paid), functionalCredit: ZERO, description: "Currency sale proceeds received",
      });
    }
    if (due > ZERO) {
      const receivable = await accountFor(tx, business.id, "receivable", transactionCurrency);
      addLine(lines, {
        accountId: receivable.id, customerId: transaction.customerId, currencyCode: transactionCurrency, debit: due, credit: ZERO,
        functionalDebit: currencyBaseAmount(total) - currencyBaseAmount(paid), functionalCredit: ZERO,
        description: "Unpaid currency sale receivable",
      });
    }
    addLine(lines, {
      accountId: inventory.id, currencyCode: tradedCurrency, debit: ZERO, credit: quantity,
      functionalDebit: ZERO, functionalCredit: cost, description: "Currency inventory issued at weighted-average cost",
    });
    const realized = currencyBaseAmount(total) - cost;
    if (realized > ZERO) {
      const gain = await accountFor(tx, business.id, "fx_gain", business.baseCurrency);
      addLine(lines, {
        accountId: gain.id, currencyCode: business.baseCurrency, debit: ZERO, credit: realized,
        functionalDebit: ZERO, functionalCredit: realized, description: "Realized currency exchange gain",
      });
    } else if (realized < ZERO) {
      const loss = await accountFor(tx, business.id, "fx_loss", business.baseCurrency);
      addLine(lines, {
        accountId: loss.id, currencyCode: business.baseCurrency, debit: -realized, credit: ZERO,
        functionalDebit: -realized, functionalCredit: ZERO, description: "Realized currency exchange loss",
      });
    }
    return { lines, costAmount: decimalString(cost) };
  }

  if (transaction.kind === "ticket" || transaction.kind === "umrah") {
    const cost = units(transaction.costAmount, "Supplier cost");
    const supplierPaid = units(transaction.supplierPaidAmount, "Supplier amount paid");
    const supplierDue = cost - supplierPaid;
    if (supplierDue > ZERO && !transaction.supplierId) throw new ApiError("Select the supplier for the unpaid service cost.");
    if (due > ZERO && !transaction.customerId) throw new ApiError("Select the customer for the unpaid balance, or record the full amount received.");
    if (supplierPaid > ZERO && !transaction.supplierPaymentAccountId) throw new ApiError("Choose the cash or bank account used to pay the supplier.");
    if (paid > ZERO) {
      const cash = await cashAccount(transaction.paymentAccountId, transactionCurrency, "Customer payment");
      if (!cash) throw new ApiError("Choose a cash or bank account for the customer payment.");
      addLine(lines, {
        accountId: cash.id, currencyCode: transactionCurrency, debit: paid, credit: ZERO,
        functionalDebit: currencyBaseAmount(paid), functionalCredit: ZERO, description: "Customer payment received",
      });
    }
    if (due > ZERO) {
      const receivable = await accountFor(tx, business.id, "receivable", transactionCurrency);
      addLine(lines, {
        accountId: receivable.id, customerId: transaction.customerId, currencyCode: transactionCurrency, debit: due, credit: ZERO,
        functionalDebit: currencyBaseAmount(total) - currencyBaseAmount(paid), functionalCredit: ZERO,
        description: "Customer amount outstanding",
      });
    }
    const revenue = await accountFor(tx, business.id, "income", transactionCurrency);
    addLine(lines, {
      accountId: revenue.id, currencyCode: transactionCurrency, debit: ZERO, credit: total,
      functionalDebit: ZERO, functionalCredit: currencyBaseAmount(total), description: "Ticket or travel-service revenue",
    });
    if (cost > ZERO) {
      const expense = await accountFor(tx, business.id, "expense", transactionCurrency);
      addLine(lines, {
        accountId: expense.id, currencyCode: transactionCurrency, debit: cost, credit: ZERO,
        functionalDebit: currencyBaseAmount(cost), functionalCredit: ZERO, description: "Supplier cost of travel service",
      });
      if (supplierPaid > ZERO) {
        const cash = await cashAccount(transaction.supplierPaymentAccountId, transactionCurrency, "Supplier payment");
        if (!cash) throw new ApiError("Choose a cash or bank account for the supplier payment.");
        addLine(lines, {
          accountId: cash.id, currencyCode: transactionCurrency, debit: ZERO, credit: supplierPaid,
          functionalDebit: ZERO, functionalCredit: currencyBaseAmount(supplierPaid), description: "Supplier cost paid",
        });
      }
      if (supplierDue > ZERO) {
        const payable = await accountFor(tx, business.id, "payable", transactionCurrency);
        addLine(lines, {
          accountId: payable.id, supplierId: transaction.supplierId, currencyCode: transactionCurrency, debit: ZERO, credit: supplierDue,
          functionalDebit: ZERO, functionalCredit: currencyBaseAmount(cost) - currencyBaseAmount(supplierPaid),
          description: "Supplier amount outstanding",
        });
      }
    }
    return { lines, costAmount: decimalString(cost) };
  }

  if (transaction.kind === "customer_payment") {
    if (!transaction.customerId) throw new ApiError("Select the customer whose balance is being paid.");
    const receivable = await accountFor(tx, business.id, "receivable", transactionCurrency);
    await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, receivable.id)).for("update");
    const outstandingRows = await tx.select({
      amount: sql<string>`coalesce(sum(${journalEntries.debit} - ${journalEntries.credit}), 0)::text`,
    }).from(journalEntries).innerJoin(accounts, eq(journalEntries.accountId, accounts.id)).where(and(
      eq(journalEntries.businessId, business.id),
      eq(journalEntries.customerId, transaction.customerId),
      eq(journalEntries.currencyCode, transactionCurrency),
      eq(accounts.type, "receivable"),
    ));
    const outstanding = units(outstandingRows[0]?.amount ?? "0");
    if (total > outstanding) throw new ApiError(`Payment exceeds this customer's ${transactionCurrency} balance of ${decimalString(outstanding)}.`, 409);
    const cash = await cashAccount(transaction.paymentAccountId, transactionCurrency, "Customer payment");
    if (!cash) throw new ApiError("Choose the cash or bank account used for this customer payment.");
    addLine(lines, {
      accountId: cash.id, currencyCode: transactionCurrency, debit: total, credit: ZERO,
      functionalDebit: currencyBaseAmount(total), functionalCredit: ZERO, description: "Customer balance payment received",
    });
    addLine(lines, {
      accountId: receivable.id, customerId: transaction.customerId, currencyCode: transactionCurrency, debit: ZERO, credit: total,
      functionalDebit: ZERO, functionalCredit: currencyBaseAmount(total), description: "Customer receivable settled",
    });
    return { lines, costAmount: "0" };
  }

  if (transaction.kind === "supplier_payment") {
    if (!transaction.supplierId) throw new ApiError("Select the supplier being paid.");
    const payable = await accountFor(tx, business.id, "payable", transactionCurrency);
    await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, payable.id)).for("update");
    const outstandingRows = await tx.select({
      amount: sql<string>`coalesce(sum(${journalEntries.credit} - ${journalEntries.debit}), 0)::text`,
    }).from(journalEntries).innerJoin(accounts, eq(journalEntries.accountId, accounts.id)).where(and(
      eq(journalEntries.businessId, business.id),
      eq(journalEntries.supplierId, transaction.supplierId),
      eq(journalEntries.currencyCode, transactionCurrency),
      eq(accounts.type, "payable"),
    ));
    const outstanding = units(outstandingRows[0]?.amount ?? "0");
    if (total > outstanding) throw new ApiError(`Payment exceeds this supplier's ${transactionCurrency} balance of ${decimalString(outstanding)}.`, 409);
    const cash = await cashAccount(transaction.paymentAccountId, transactionCurrency, "Supplier payment");
    if (!cash) throw new ApiError("Choose the cash or bank account used for this supplier payment.");
    addLine(lines, {
      accountId: payable.id, supplierId: transaction.supplierId, currencyCode: transactionCurrency, debit: total, credit: ZERO,
      functionalDebit: currencyBaseAmount(total), functionalCredit: ZERO, description: "Supplier payable settled",
    });
    addLine(lines, {
      accountId: cash.id, currencyCode: transactionCurrency, debit: ZERO, credit: total,
      functionalDebit: ZERO, functionalCredit: currencyBaseAmount(total), description: "Supplier balance paid",
    });
    return { lines, costAmount: "0" };
  }

  if (transaction.kind === "expense") {
    if (due > ZERO && !transaction.supplierId) throw new ApiError("Select a supplier for an unpaid expense, or record the amount paid.");
    const expense = await accountFor(tx, business.id, "expense", transactionCurrency);
    addLine(lines, {
      accountId: expense.id, currencyCode: transactionCurrency, debit: total, credit: ZERO,
      functionalDebit: currencyBaseAmount(total), functionalCredit: ZERO, description: transaction.description || "Operating expense",
    });
    if (paid > ZERO) {
      const cash = await cashAccount(transaction.paymentAccountId, transactionCurrency, "Expense payment");
      if (!cash) throw new ApiError("Choose the cash or bank account used for this expense.");
      addLine(lines, {
        accountId: cash.id, currencyCode: transactionCurrency, debit: ZERO, credit: paid,
        functionalDebit: ZERO, functionalCredit: currencyBaseAmount(paid), description: "Expense paid",
      });
    }
    if (due > ZERO) {
      const payable = await accountFor(tx, business.id, "payable", transactionCurrency);
      addLine(lines, {
        accountId: payable.id, supplierId: transaction.supplierId, currencyCode: transactionCurrency, debit: ZERO, credit: due,
        functionalDebit: ZERO, functionalCredit: currencyBaseAmount(total) - currencyBaseAmount(paid), description: "Unpaid expense payable",
      });
    }
    return { lines, costAmount: "0" };
  }

  if (transaction.kind === "income") {
    if (due > ZERO && !transaction.customerId) throw new ApiError("Select a customer for unpaid income, or record the full amount received.");
    if (paid > ZERO) {
      const cash = await cashAccount(transaction.paymentAccountId, transactionCurrency, "Income receipt");
      if (!cash) throw new ApiError("Choose the cash or bank account where income was received.");
      addLine(lines, {
        accountId: cash.id, currencyCode: transactionCurrency, debit: paid, credit: ZERO,
        functionalDebit: currencyBaseAmount(paid), functionalCredit: ZERO, description: "Income received",
      });
    }
    if (due > ZERO) {
      const receivable = await accountFor(tx, business.id, "receivable", transactionCurrency);
      addLine(lines, {
        accountId: receivable.id, customerId: transaction.customerId, currencyCode: transactionCurrency, debit: due, credit: ZERO,
        functionalDebit: currencyBaseAmount(total) - currencyBaseAmount(paid), functionalCredit: ZERO, description: "Unpaid income receivable",
      });
    }
    const income = await accountFor(tx, business.id, "income", transactionCurrency);
    addLine(lines, {
      accountId: income.id, currencyCode: transactionCurrency, debit: ZERO, credit: total,
      functionalDebit: ZERO, functionalCredit: currencyBaseAmount(total), description: transaction.description || "Other business income",
    });
    return { lines, costAmount: "0" };
  }

  throw new ApiError("This financial transaction type cannot be posted.", 409);
}

async function writeJournal(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  transaction: typeof financialTransactions.$inferSelect,
  business: typeof businesses.$inferSelect,
): Promise<string> {
  if (transaction.reversalOfId) {
    const originals = await tx
      .select()
      .from(financialTransactions)
      .where(and(eq(financialTransactions.id, transaction.reversalOfId), eq(financialTransactions.businessId, business.id)))
      .limit(1);
    const original = originals[0];
    if (!original || original.status !== "posted" || original.reversedById) {
      throw new ApiError("This transaction is unavailable for reversal or has already been reversed.", 409);
    }
    const claimed = await tx
      .update(financialTransactions)
      .set({ reversedById: transaction.id, updatedAt: new Date(), version: sql`${financialTransactions.version} + 1` })
      .where(and(eq(financialTransactions.id, original.id), sql`${financialTransactions.reversedById} is null`))
      .returning({ id: financialTransactions.id });
    if (!claimed[0]) throw new ApiError("Another request has already reversed this transaction.", 409);
    const entries = await tx.select().from(journalEntries).where(eq(journalEntries.transactionId, original.id));
    // A purchase that added stock cannot be reversed once that stock has been issued;
    // allow the disposition to be reversed first so inventory never goes negative.
    if (original.kind === "fx_purchase" && original.tradedCurrency && original.quantity) {
      const inventory = await accountFor(tx, business.id, "inventory", original.tradedCurrency);
      await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, inventory.id)).for("update");
      const remaining = await inventoryPosition(tx, business.id, original.tradedCurrency);
      const reversedQuantity = units(original.quantity, "Quantity");
      if (remaining.quantity < reversedQuantity) {
        throw new ApiError(
          `This purchase cannot be reversed because ${decimalString(reversedQuantity)} ${original.tradedCurrency} has already been issued. Available stock is ${decimalString(remaining.quantity)} ${original.tradedCurrency}. Reverse the related sale first so inventory never becomes negative.`,
          409,
        );
      }
    }
    if (entries.length < 2) throw new ApiError("The original transaction has no complete journal to reverse.", 409);
    const reversals: JournalLine[] = entries.map((entry) => ({
      accountId: entry.accountId,
      customerId: entry.customerId,
      supplierId: entry.supplierId,
      currencyCode: entry.currencyCode,
      debit: units(entry.credit),
      credit: units(entry.debit),
      functionalDebit: units(entry.functionalCredit),
      functionalCredit: units(entry.functionalDebit),
      description: `Reversal of ${original.receiptNumber ?? original.id}`,
    }));
    ensureBalanced(reversals);
    await tx.insert(journalEntries).values(reversals.map((line) => ({
      businessId: business.id,
      transactionId: transaction.id,
      accountId: line.accountId,
      customerId: line.customerId ?? null,
      supplierId: line.supplierId ?? null,
      currencyCode: line.currencyCode,
      debit: decimalString(line.debit),
      credit: decimalString(line.credit),
      baseCurrency: business.baseCurrency,
      functionalDebit: decimalString(line.functionalDebit),
      functionalCredit: decimalString(line.functionalCredit),
      description: line.description,
    })));
    return original.costAmount ?? "0";
  }

  const result = await buildJournal(tx, transaction, business);
  ensureBalanced(result.lines);
  if (result.lines.length < 2) throw new ApiError("A financial posting requires at least two ledger lines.", 409);
  await tx.insert(journalEntries).values(result.lines.map((line) => ({
    businessId: business.id,
      transactionId: transaction.id,
      accountId: line.accountId,
      customerId: line.customerId ?? null,
      supplierId: line.supplierId ?? null,
      currencyCode: line.currencyCode,
      debit: decimalString(line.debit),
    credit: decimalString(line.credit),
    baseCurrency: business.baseCurrency,
    functionalDebit: decimalString(line.functionalDebit),
    functionalCredit: decimalString(line.functionalCredit),
    description: line.description,
  })));
  return result.costAmount;
}

function receiptPrefix(slug: string): string {
  const initials = slug.split("-").filter(Boolean).map((word) => word[0]?.toUpperCase()).join("").slice(0, 4);
  return initials || "BIZ";
}

export async function approveDraft(transactionId: string, businessId: string, ownerId: string, expectedVersion: number) {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .update(financialTransactions)
      .set({ status: "posting", updatedAt: new Date() })
      .where(and(
        eq(financialTransactions.id, transactionId),
        eq(financialTransactions.businessId, businessId),
        eq(financialTransactions.status, "draft"),
        eq(financialTransactions.version, expectedVersion),
      ))
      .returning();

    if (!locked) {
      const [current] = await tx
        .select()
        .from(financialTransactions)
        .where(and(eq(financialTransactions.id, transactionId), eq(financialTransactions.businessId, businessId)))
        .limit(1);
      if (current?.status === "posted") return current;
      if (!current) throw new ApiError("Draft was not found.", 404);
      throw new ApiError("This draft changed or is no longer awaiting approval. Refresh and review the latest version.", 409, { currentVersion: current.version });
    }

    const [business] = await tx.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
    if (!business) throw new ApiError("Business workspace was not found.", 404);
    const costAmount = await writeJournal(tx, locked, business);
    const [sequence] = await tx
      .update(businesses)
      .set({ receiptSequence: sql`${businesses.receiptSequence} + 1`, updatedAt: new Date() })
      .where(eq(businesses.id, businessId))
      .returning({ receiptSequence: businesses.receiptSequence, slug: businesses.slug });
    if (!sequence) throw new ApiError("Could not allocate a receipt number.", 500);
    const receiptNumber = `${receiptPrefix(sequence.slug)}-${String(sequence.receiptSequence).padStart(6, "0")}`;
    const [posted] = await tx
      .update(financialTransactions)
      .set({
        status: "posted",
        receiptNumber,
        approverId: ownerId,
        approvedAt: new Date(),
        costAmount,
        version: sql`${financialTransactions.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(financialTransactions.id, locked.id))
      .returning();
    await tx.insert(receipts).values({
      businessId,
      transactionId,
      receiptNumber,
      documentType: locked.reversalOfId ? "reversal-receipt" : "final-transaction-receipt",
      createdBy: ownerId,
    });
    await tx.insert(auditLogs).values({
      businessId,
      userId: ownerId,
      action: locked.reversalOfId ? "transaction.reversed" : "transaction.approved",
      entityType: "financial_transaction",
      entityId: transactionId,
      details: { receiptNumber, amount: posted.totalAmount, currency: posted.settlementCurrency, version: posted.version },
    });
    return posted;
  });
}

export async function createReversalDraft(transactionId: string, businessId: string, ownerId: string) {
  return db.transaction(async (tx) => {
    const [original] = await tx
      .select()
      .from(financialTransactions)
      .where(and(eq(financialTransactions.id, transactionId), eq(financialTransactions.businessId, businessId)))
      .limit(1);
    if (!original || original.status !== "posted") throw new ApiError("Only a finalized transaction can be reversed.", 409);
    if (original.reversedById) throw new ApiError("This transaction already has an approved reversal.", 409);
    const key = `reversal-${original.id}`;
    const [existing] = await tx
      .select()
      .from(financialTransactions)
      .where(and(eq(financialTransactions.businessId, businessId), eq(financialTransactions.idempotencyKey, key)))
      .limit(1);
    if (existing) return existing;
    const [draft] = await tx
      .insert(financialTransactions)
      .values({
        businessId,
        kind: "reversal",
        status: "draft",
        transactionDate: new Date(),
        quantity: original.quantity,
        tradedCurrency: original.tradedCurrency,
        settlementCurrency: original.settlementCurrency,
        rate: original.rate,
        baseRate: original.baseRate,
        grossAmount: original.grossAmount,
        fee: original.fee,
        totalAmount: original.totalAmount,
        costAmount: original.costAmount,
        paymentAmount: original.paymentAmount,
        paymentAccountId: original.paymentAccountId,
        supplierPaidAmount: original.supplierPaidAmount,
        supplierPaymentAccountId: original.supplierPaymentAccountId,
        customerId: original.customerId,
        supplierId: original.supplierId,
        location: original.location,
        description: `Reversal of ${original.receiptNumber ?? original.id}`,
        notes: "Owner-requested reversal. The original posting remains in the audit trail.",
        metadata: { originalTransactionId: original.id, originalReceiptNumber: original.receiptNumber },
        idempotencyKey: key,
        creatorId: ownerId,
        reversalOfId: original.id,
      })
      .returning();
    await tx.insert(auditLogs).values({
      businessId,
      userId: ownerId,
      action: "transaction.reversal_drafted",
      entityType: "financial_transaction",
      entityId: draft.id,
      details: { originalTransactionId: original.id },
    });
    return draft;
  });
}

export async function rejectDraft(transactionId: string, businessId: string, ownerId: string, version: number, reason: string) {
  return db.transaction(async (tx) => {
    const [rejected] = await tx
      .update(financialTransactions)
      .set({
        status: "rejected",
        rejectionReason: reason.trim().slice(0, 500) || "Rejected by owner",
        approverId: ownerId,
        version: sql`${financialTransactions.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(financialTransactions.id, transactionId),
        eq(financialTransactions.businessId, businessId),
        eq(financialTransactions.status, "draft"),
        eq(financialTransactions.version, version),
      ))
      .returning();
    if (!rejected) throw new ApiError("Draft changed or is no longer awaiting a decision. Refresh and try again.", 409);
    await tx.insert(auditLogs).values({
      businessId,
      userId: ownerId,
      action: "transaction.rejected",
      entityType: "financial_transaction",
      entityId: transactionId,
      details: { reason: rejected.rejectionReason },
    });
    return rejected;
  });
}

export async function calculateDraftImpact(transaction: typeof financialTransactions.$inferSelect, baseCurrency: string) {
  const total = units(transaction.totalAmount);
  const paid = units(transaction.paymentAmount);
  const result: Record<string, unknown> = {
    totalAmount: transaction.totalAmount,
    currency: transaction.settlementCurrency,
    amountPaid: transaction.paymentAmount,
    amountOutstanding: decimalString(total - paid),
    paymentStatus: paid === ZERO ? "unpaid" : paid === total ? "paid" : "partial",
    reportingCurrency: baseCurrency,
    approvalRequired: true,
  };
  if ((transaction.kind === "fx_purchase" || transaction.kind === "fx_sale") && transaction.tradedCurrency) {
    const snapshot = await getInventorySnapshot(transaction.businessId, transaction.tradedCurrency, baseCurrency);
    result.inventoryBefore = snapshot;
    if (transaction.kind === "fx_purchase") {
      result.inventoryAfterDraft = decimalString(units(snapshot.quantity) + units(transaction.quantity));
      result.inventoryEffect = `Increase ${transaction.tradedCurrency} stock by ${transaction.quantity} ${transaction.tradedCurrency}`;
      result.expectedCost = transaction.totalAmount;
    } else {
      const quantity = units(transaction.quantity);
      const available = units(snapshot.quantity);
      result.inventoryAfterDraft = decimalString(available - quantity);
      result.inventoryEffect = `Decrease ${transaction.tradedCurrency} stock by ${transaction.quantity} ${transaction.tradedCurrency}`;
      result.availableStock = snapshot.quantity;
      if (available < quantity) {
        result.blocked = true;
        result.warning = `Insufficient stock. Available: ${snapshot.quantity} ${transaction.tradedCurrency}.`;
      } else if (available > ZERO) {
        const cogs = available === quantity
          ? units(snapshot.carryingValue)
          : roundTo(multiply(quantity, divide(units(snapshot.carryingValue), available)), 2);
        result.expectedCost = decimalString(cogs);
        result.expectedRealizedProfit = decimalString(units(transaction.totalAmount) - cogs);
      }
    }
  }
  if ((transaction.kind === "ticket" || transaction.kind === "umrah") && transaction.costAmount) {
    result.preliminaryMargin = decimalString(total - units(transaction.costAmount));
  }
  if (!transaction.baseRate && transaction.settlementCurrency !== baseCurrency) {
    result.missingReportingRate = true;
    result.warning = `${transaction.settlementCurrency} to ${baseCurrency} reporting rate is required before approval.`;
  }
  return result;
}
