import { and, eq, ilike, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { accounts, businesses, financialTransactions, journalEntries } from "@/db/schema";
import type { CurrentUser } from "@/lib/auth";
import { ApiError } from "@/lib/auth";
import { createFinancialDraft } from "@/lib/finance";
import { getDashboardOverview, getReport } from "@/lib/overview";
import { calculateDraftImpact } from "@/lib/posting";
import { decimalString, parseDecimal, roundTo } from "@/lib/decimal";
import { getCurrencyStock } from "@/lib/finance";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
const INSTRUCTIONS = `You are a careful business assistant for an owner. Use tools to retrieve authorized records and calculate business facts. Never invent exchange rates, account balances, customer data, confirmations, or booking status. You may create a transaction draft only; never claim that a draft was posted or approved. A human owner must approve every financial posting. Ask a concise clarification if a currency, rate, account, counterparty, payment status, or date is unclear. Keep confidential supplier costs and profit details internal unless the owner asks for an internal report. Respond in the language used by the owner (English, Bengali, or Arabic).`;

const toolDefinitions = [
  {
    type: "function",
    name: "get_business_summary",
    description: "Read today's ledger-based summary for the currently selected authorized workspace.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "get_currency_stock",
    description: "Read posted currency inventory and weighted-average valuation. Provide a currency code or null for all non-zero stock.",
    parameters: {
      type: "object",
      properties: { currency: { type: ["string", "null"] } },
      required: ["currency"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "search_transactions",
    description: "Search recent authorized transactions by counterparty, receipt, description, or location.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "create_transaction_draft",
    description: "Create a validated draft only. Missing payment accounts or counterparties stay unresolved and must be confirmed before owner approval. Never posts money.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["fx_purchase", "fx_sale", "income", "expense"] },
        quantity: { type: ["string", "null"] },
        tradedCurrency: { type: ["string", "null"] },
        settlementCurrency: { type: ["string", "null"] },
        rate: { type: ["string", "null"] },
        grossAmount: { type: ["string", "null"] },
        fee: { type: "string" },
        paymentAmount: { type: "string" },
        paymentAccountId: { type: ["string", "null"] },
        customerId: { type: ["string", "null"] },
        supplierId: { type: ["string", "null"] },
        location: { type: ["string", "null"] },
        notes: { type: ["string", "null"] },
      },
      required: [
        "kind", "quantity", "tradedCurrency", "settlementCurrency", "rate", "grossAmount", "fee", "paymentAmount",
        "paymentAccountId", "customerId", "supplierId", "location", "notes",
      ],
      additionalProperties: false,
    },
    strict: true,
  },
];

export function assistantConfiguration() {
  const configured = Boolean(process.env.OPENAI_API_KEY);
  return {
    configured,
    provider: configured ? (process.env.AI_PROVIDER || "openai") : "local-rules",
    model: configured ? (process.env.OPENAI_MODEL || "gpt-4.1-mini") : null,
    missing: configured ? [] : ["OPENAI_API_KEY"],
    speechInput: "Browser speech recognition when supported; no audio is uploaded by the app.",
    speechOutput: "Device/browser text-to-speech when supported.",
  };
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  business: typeof businesses.$inferSelect,
  user: CurrentUser,
) {
  if (name === "get_business_summary") {
    const overview = await getDashboardOverview(business);
    return { business: business.name, summary: overview.today, pendingApprovals: overview.pendingApprovals, stock: overview.stocks };
  }
  if (name === "get_currency_stock") {
    const requested = typeof args.currency === "string" ? args.currency.toUpperCase() : null;
    const stock = await getCurrencyStock(business.id, business.baseCurrency);
    return requested ? stock.filter((row) => row.currency === requested) : stock;
  }
  if (name === "search_transactions") {
    const query = typeof args.query === "string" ? args.query.trim().slice(0, 100) : "";
    const rows = await db.select().from(financialTransactions).where(and(
      eq(financialTransactions.businessId, business.id),
      query
        ? or(
            ilike(financialTransactions.description, `%${query}%`),
            ilike(financialTransactions.notes, `%${query}%`),
            ilike(financialTransactions.location, `%${query}%`),
            ilike(financialTransactions.receiptNumber, `%${query}%`),
          )
        : sql`true`,
    )).orderBy(sql`${financialTransactions.createdAt} desc`).limit(10);
    return rows.map((row) => ({
      id: row.id,
      type: row.kind,
      status: row.status,
      receipt: row.receiptNumber,
      amount: row.totalAmount,
      currency: row.settlementCurrency,
      description: row.description,
      date: row.transactionDate,
    }));
  }
  if (name === "create_transaction_draft") {
    const draftInput = {
      ...args,
      businessId: business.id,
      idempotencyKey: `assistant-${randomUUID()}`,
    };
    const draft = await createFinancialDraft(draftInput, user.id);
    return {
      transactionId: draft.id,
      status: draft.status,
      draftOnly: true,
      preview: await calculateDraftImpact(draft, business.baseCurrency),
      note: "This is only a draft. Owner approval is still required before any ledger or balance changes.",
    };
  }
  throw new ApiError("That assistant tool is not available.", 400);
}

function extractResponseText(data: Record<string, unknown>): string {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const output = Array.isArray(data.output) ? data.output : [];
  const texts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type !== "message" || !Array.isArray(record.content)) continue;
    for (const content of record.content) {
      if (content && typeof content === "object") {
        const piece = content as Record<string, unknown>;
        if (piece.type === "output_text" && typeof piece.text === "string") texts.push(piece.text);
      }
    }
  }
  return texts.join("\n").trim();
}

async function callOpenAI(message: string, business: typeof businesses.$inferSelect, user: CurrentUser) {
  const firstResponse = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      instructions: `${INSTRUCTIONS}\nCurrent workspace: ${business.name} (${business.category}). Reporting currency: ${business.baseCurrency}. Today: ${new Date().toISOString()}.`,
      input: [{ role: "user", content: message }],
      tools: toolDefinitions,
      tool_choice: "auto",
      max_output_tokens: 700,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!firstResponse.ok) {
    const body = await firstResponse.text();
    throw new Error(`AI provider returned ${firstResponse.status}: ${body.slice(0, 200)}`);
  }
  const first = await firstResponse.json() as Record<string, unknown>;
  const output = Array.isArray(first.output) ? first.output : [];
  const calls = output.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && (item as Record<string, unknown>).type === "function_call")).slice(0, 3);
  if (calls.length === 0) return { text: extractResponseText(first) || "I could not form a reliable answer. Please add more detail.", draft: null, provider: "openai" };

  const toolOutputs: Array<Record<string, unknown>> = [];
  let draft: Record<string, unknown> | null = null;
  for (const call of calls) {
    const name = typeof call.name === "string" ? call.name : "";
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(typeof call.arguments === "string" ? call.arguments : "{}") as Record<string, unknown>;
    } catch {
      throw new ApiError("The assistant returned an invalid structured action. No action was performed.", 502);
    }
    const result = await executeTool(name, args, business, user);
    if (name === "create_transaction_draft") draft = result as Record<string, unknown>;
    toolOutputs.push({
      type: "function_call_output",
      call_id: call.call_id,
      output: safeJson(result),
    });
  }

  const secondResponse = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      instructions: `${INSTRUCTIONS}\nReport tool results accurately. A draft is not an approval or a posted transaction.`,
      input: [...output, ...toolOutputs],
      max_output_tokens: 500,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!secondResponse.ok) {
    return {
      text: draft ? "A validated draft was created. Review its preview and missing details before owner approval." : "I retrieved the requested business records, but could not compose a response.",
      draft,
      provider: "openai",
    };
  }
  const second = await secondResponse.json() as Record<string, unknown>;
  return {
    text: extractResponseText(second) || (draft ? "A draft is ready for review. Nothing has been posted." : "I found the requested records."),
    draft,
    provider: "openai",
  };
}

function normalizeDigits(text: string): string {
  const maps: Record<string, string> = {
    "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4", "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  };
  return Array.from(text, (char) => maps[char] ?? char).join("");
}

const currencyPatterns: Array<{ code: string; patterns: RegExp[] }> = [
  { code: "EGP", patterns: [/\begp\b/i, /egypt(?:ian)?\s+pounds?/i, /egyptian\s+le/i, /مصر(?:ي|ية|ى)|جنيه\s+مصري|جنيه\s+مصر/i, /মিশর[ীি]য়\s+পাউন্ড|মিশরীয়\s+পাউন্ড/i] },
  { code: "USD", patterns: [/\busd\b/i, /\b(?:us\s+)?dollars?\b/i, /\$\s?/, /ডলার/i, /دولار/i] },
  { code: "GBP", patterns: [/\bgbp\b/i, /\bbritish\s+pounds?\b/i, /\bpounds?\s+sterling\b/i, /পাউন্ড\s+স্টার্লিং/i, /جنيه\s+إسترليني/i] },
  { code: "BDT", patterns: [/\bbdt\b/i, /\bbangladeshi\s+taka\b/i, /\btaka\b/i, /টাকা/i, /تاكا/i] },
  { code: "SAR", patterns: [/\bsar\b/i, /saudi\s+riyals?/i, /রিয়াল/i, /ريال/i] },
  { code: "EUR", patterns: [/\beur\b/i, /\beuros?\b/i, /ইউরো/i, /يورو/i] },
  { code: "AED", patterns: [/\baed\b/i, /uae\s+dirhams?/i, /درهم/i] },
];

function findCurrency(text: string): string | null {
  return currencyPatterns.find((currency) => currency.patterns.some((pattern) => pattern.test(text)))?.code ?? null;
}

function findAllCurrencies(text: string): string[] {
  const found: string[] = [];
  for (const currency of currencyPatterns) {
    if (currency.patterns.some((pattern) => pattern.test(text)) && !found.includes(currency.code)) found.push(currency.code);
  }
  return found;
}

function findLocation(message: string): string | null {
  const english = message.match(/\b(?:in|from|at)\s+([A-Z][a-zA-Z .'-]{2,40}?)(?=\s+(?:at|with|for|rate|on|for|and)\b|[,.!?]|$)/);
  if (english && !/^\d/.test(english[1])) return english[1].trim();
  const bengali = message.match(/(?:থেকে|এ|তে)\s+([\p{L} .'-]{2,40}?)(?=\s+(?:রেটে|দরে|এ|তে)|[,.!?]|$)/u);
  return bengali?.[1]?.trim() ?? null;
}

async function localAssistant(message: string, business: typeof businesses.$inferSelect, user: CurrentUser) {
  const lower = message.toLowerCase();
  const normalized = normalizeDigits(message).replace(/٬/g, ",").replace(/٫/g, ".");
  const asksReceipt = /receipt|slip|রসিদ|স্লিপ|إيصال|وصل/i.test(message);
  if (asksReceipt) {
    return {
      text: "I will not create a duplicate transaction for a receipt. Open Receipts, select the existing posted transaction, and preview its final slip; only approved postings have final receipts.",
      draft: null,
      provider: "local-rules",
    };
  }

  const buy = /\b(buy|bought|purchase|purchased)\b|কিনেছি|কিনলাম|ক্রয়|কেনা|اشتريت/i.test(message);
  const sell = /\b(sell|sold|sale)\b|বিক্রি|বেচেছি|বিক্রি করেছি|بعت/i.test(message);
  if (buy || sell) {
    const numbers = [...normalized.matchAll(/\d[\d,]*(?:\.\d+)?/g)];
    if (numbers.length < 2) {
      return { text: "I need a quantity and an owner-entered exchange rate. Please include both values and their currencies.", draft: null, provider: "local-rules" };
    }
    const first = numbers[0];
    const second = numbers[1];
    const quantity = (first[0] ?? "").replace(/,/g, "");
    const rate = (second[0] ?? "").replace(/,/g, "");
    const between = normalized.slice((first.index ?? 0) + first[0].length, second.index ?? normalized.length);
    const afterRate = normalized.slice((second.index ?? 0) + second[0].length);
    let tradedCurrency = findCurrency(between);
    let settlementCurrency = findCurrency(afterRate);
    const allCurrencies = findAllCurrencies(normalized);
    if (!tradedCurrency && allCurrencies.length > 0) tradedCurrency = allCurrencies[0];
    if (!settlementCurrency && allCurrencies.length > 1) settlementCurrency = allCurrencies.find((currency) => currency !== tradedCurrency) ?? null;
    if (!settlementCurrency && allCurrencies.length === 1 && allCurrencies[0] !== tradedCurrency) settlementCurrency = allCurrencies[0];
    if (!tradedCurrency || !settlementCurrency) {
      return { text: "I found a quantity and rate, but could not confirm both currency codes. Please specify the traded currency and the rate currency (for example, USD at 128.24 EGP per USD).", draft: null, provider: "local-rules" };
    }
    try {
      const draft = await createFinancialDraft({
        businessId: business.id,
        kind: buy ? "fx_purchase" : "fx_sale",
        quantity,
        tradedCurrency,
        settlementCurrency,
        rate,
        paymentAmount: "0",
        fee: "0",
        location: findLocation(message),
        notes: "Draft created from a local language rule. Confirm account and counterparty before approval.",
        idempotencyKey: `local-assistant-${randomUUID()}`,
      }, user.id);
      const impact = await calculateDraftImpact(draft, business.baseCurrency);
      const amount = decimalString(roundTo(parseDecimal(quantity) * parseDecimal(rate) / BigInt(100_000_000), 2));
      const verb = buy ? "purchase" : "sale";
      const missing = buy
        ? "No payment account or supplier was assumed; select the cash/bank account or identify the supplier before approval."
        : "No payment account or customer was assumed; select the receiving account or identify the customer before approval.";
      return {
        text: `${buy ? "Purchase" : "Sale"} draft created: ${quantity} ${tradedCurrency} × ${rate} ${settlementCurrency}/${tradedCurrency} = ${amount} ${settlementCurrency}. ${missing} The owner must approve it before any balances or stock change.`,
        draft: { transactionId: draft.id, status: draft.status, impact },
        provider: "local-rules",
      };
    } catch (error) {
      return { text: error instanceof Error ? error.message : "The draft could not be validated.", draft: null, provider: "local-rules" };
    }
  }

  if (/stock|inventory|left|available|স্টক|মজুদ|inventory|رصيد|مخزون/i.test(lower)) {
    const currency = findCurrency(normalized);
    if (!currency) return { text: "Which currency should I check? For example, USD inventory.", draft: null, provider: "local-rules" };
    const rows = await getCurrencyStock(business.id, business.baseCurrency);
    const stock = rows.find((item) => item.currency === currency);
    return {
      text: stock
        ? `${business.name} has ${stock.quantity} ${currency} in approved inventory. Weighted-average carrying value is ${stock.carryingValue} ${stock.baseCurrency}; average cost is ${stock.averageCost} ${stock.baseCurrency} per ${currency}.`
        : `There is no posted ${currency} inventory in ${business.name}. Drafts do not affect stock.`,
      draft: null,
      provider: "local-rules",
    };
  }

  if (/last month|previous month|গত মাস|الشهر الماضي/i.test(lower) && /expense|cost|খরচ|ব্যয়|مصروف/i.test(lower)) {
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    const report = await getReport(business, from.toISOString(), to.toISOString());
    return { text: `Approved expenses for the requested period total ${report.expenses} ${report.reportingCurrency}. This report is based on posted ledger entries only.`, draft: null, provider: "local-rules" };
  }

  if (/profit|net income|লাভ|মুনাফা|ربح/i.test(lower)) {
    const overview = await getDashboardOverview(business);
    return {
      text: `Today's net profit for ${business.name} is ${overview.today.netProfit} ${business.baseCurrency}, based only on approved ledger entries. Realized exchange gain: ${overview.today.realizedExchangeGains} ${business.baseCurrency}; expenses: ${overview.today.expenses} ${business.baseCurrency}.`,
      draft: null,
      provider: "local-rules",
    };
  }

  if (/outstanding|receivable|payable|due|باقي|مستحق|বাকি|পাওনা|দেনা/i.test(lower)) {
    const rows = await db.select({
      type: accounts.type,
      currency: journalEntries.currencyCode,
      amount: sql<string>`coalesce(sum(case when ${accounts.type} = 'receivable' then ${journalEntries.debit} - ${journalEntries.credit} else ${journalEntries.credit} - ${journalEntries.debit} end), 0)::text`,
    }).from(journalEntries)
      .innerJoin(accounts, eq(journalEntries.accountId, accounts.id))
      .where(and(eq(journalEntries.businessId, business.id), sql`${accounts.type} in ('receivable','payable')`))
      .groupBy(accounts.type, journalEntries.currencyCode);
    const balances = rows.filter((row) => parseDecimal(row.amount ?? "0") > BigInt(0));
    return {
      text: balances.length
        ? `Open balances for ${business.name}: ${balances.map((row) => `${row.amount} ${row.currency} ${row.type === "receivable" ? "receivable" : "payable"}`).join("; ")}. Amounts remain separated by currency.`
        : `There are no open posted receivable or payable balances for ${business.name}.`,
      draft: null,
      provider: "local-rules",
    };
  }

  return {
    text: "I can check posted stock, today's profit, outstanding balances, recent transactions, or create a purchase/sale draft. For broader Bengali, English, or Arabic understanding, configure OPENAI_API_KEY in the server environment. I will never post a financial transaction without owner approval.",
    draft: null,
    provider: "local-rules",
  };
}

export async function runAssistant(messageValue: unknown, business: typeof businesses.$inferSelect, user: CurrentUser) {
  const message = typeof messageValue === "string" ? messageValue.trim().slice(0, 4_000) : "";
  if (!message) throw new ApiError("Enter a question or command first.");
  if (process.env.OPENAI_API_KEY) {
    try {
      return await callOpenAI(message, business, user);
    } catch {
      const fallback = await localAssistant(message, business, user);
      return {
        ...fallback,
        provider: "local-rules",
        providerWarning: "The configured AI provider was unavailable; the request was handled by limited local rules instead.",
      };
    }
  }
  return localAssistant(message, business, user);
}
