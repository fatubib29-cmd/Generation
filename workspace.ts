import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, businessCurrencies, businesses } from "@/db/schema";

export const CURRENCY_CATALOG = [
  { code: "EGP", name: "Egyptian pound", symbol: "E£", decimalPlaces: 2 },
  { code: "USD", name: "US dollar", symbol: "$", decimalPlaces: 2 },
  { code: "GBP", name: "British pound", symbol: "£", decimalPlaces: 2 },
  { code: "BDT", name: "Bangladeshi taka", symbol: "৳", decimalPlaces: 2 },
  { code: "SAR", name: "Saudi riyal", symbol: "﷼", decimalPlaces: 2 },
  { code: "EUR", name: "Euro", symbol: "€", decimalPlaces: 2 },
  { code: "AED", name: "UAE dirham", symbol: "د.إ", decimalPlaces: 2 },
] as const;

const INITIAL_BUSINESSES = [
  {
    name: "Osama Trusted Solutions",
    slug: "osama-trusted-solutions",
    category: "currency_exchange",
    baseCurrency: "EGP",
    primaryColor: "#13243d",
    accentColor: "#c9a66b",
    logoUrl: "/branding/osama-trusted-solutions.svg",
  },
  {
    name: "Qasemi Tours and Travels",
    slug: "qasemi-tours-and-travels",
    category: "travel_agency",
    baseCurrency: "EGP",
    primaryColor: "#123c3c",
    accentColor: "#d2b679",
    logoUrl: "/branding/qasemi-tours-and-travels.svg",
  },
] as const;

const SYSTEM_ACCOUNT_TYPES = [
  { type: "inventory", label: "Currency inventory" },
  { type: "receivable", label: "Accounts receivable" },
  { type: "payable", label: "Accounts payable" },
  { type: "income", label: "Service income" },
  { type: "expense", label: "Operating expense" },
  { type: "fx_gain", label: "Realized exchange gain" },
  { type: "fx_loss", label: "Realized exchange loss" },
] as const;

function accountCode(type: string, currency: string): string {
  return `${type}_${currency}`.toUpperCase();
}

export async function ensureBusinessDefaults(businessId: string, baseCurrency = "EGP"): Promise<void> {
  const supported = new Set<string>(CURRENCY_CATALOG.map((currency) => currency.code));
  if (!supported.has(baseCurrency)) supported.add(baseCurrency);
  const currencies = [...supported];

  await db
    .insert(businessCurrencies)
    .values(
      CURRENCY_CATALOG.map((currency) => ({
        businessId,
        code: currency.code,
        name: currency.name,
        symbol: currency.symbol,
        decimalPlaces: currency.decimalPlaces,
      })),
    )
    .onConflictDoNothing();

  const values: Array<{
    businessId: string;
    code: string;
    name: string;
    type: string;
    currencyCode: string;
    isSystem: boolean;
  }> = [];

  for (const currency of currencies) {
    values.push({
      businessId,
      code: accountCode("cash", currency),
      name: `Cash · ${currency}`,
      type: "cash",
      currencyCode: currency,
      isSystem: false,
    });
    if (currency === baseCurrency || currency === "USD") {
      values.push({
        businessId,
        code: accountCode("bank", currency),
        name: `Bank · ${currency}`,
        type: "bank",
        currencyCode: currency,
        isSystem: false,
      });
    }
    for (const system of SYSTEM_ACCOUNT_TYPES) {
      values.push({
        businessId,
        code: accountCode(system.type, currency),
        name: `${system.label} · ${currency}`,
        type: system.type,
        currencyCode: currency,
        isSystem: true,
      });
    }
  }

  await db.insert(accounts).values(values).onConflictDoNothing();
}

export async function ensurePlatformSeeded(): Promise<void> {
  for (const definition of INITIAL_BUSINESSES) {
    let [business] = await db.select().from(businesses).where(eq(businesses.slug, definition.slug)).limit(1);
    if (!business) {
      [business] = await db.insert(businesses).values(definition).returning();
    }
    await ensureBusinessDefaults(business.id, business.baseCurrency);
  }
}

export async function findBusinessByNameOrId(value: string) {
  const byId = await db.select().from(businesses).where(eq(businesses.id, value)).limit(1);
  if (byId[0]) return byId[0];
  const normalized = value.trim().toLowerCase();
  const known = await db.select().from(businesses);
  return known.find((business) => business.name.toLowerCase() === normalized || business.slug === normalized) ?? null;
}

export async function currencyForBusiness(businessId: string, code: string) {
  const rows = await db
    .select()
    .from(businessCurrencies)
    .where(and(eq(businessCurrencies.businessId, businessId), eq(businessCurrencies.code, code.toUpperCase()), eq(businessCurrencies.active, true)))
    .limit(1);
  return rows[0] ?? null;
}
