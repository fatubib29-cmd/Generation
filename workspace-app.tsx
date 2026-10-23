"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { apiRequest } from "@/lib/client-api";
import { add, decimalString, parseDecimal } from "@/lib/decimal";
import { AuthPanel } from "@/components/auth-panel";
import { ContactStatementModal } from "@/components/contact-modal";
import { Icon, EmptyState, SectionHeading, StatusPill, formatMoney, initials, type IconName } from "@/components/common";
import {
  AccountFormModal,
  BookingFormModal,
  BusinessFormModal,
  ContactFormModal,
  CurrencyFormModal,
  ExchangeFormModal,
  IncomeExpenseModal,
  PaymentFormModal,
  StaffFormModal,
} from "@/components/forms";
import { ReceiptModal } from "@/components/receipt-modal";
import { ReviewModal } from "@/components/review-modal";
import type {
  Account,
  AuditEvent,
  BookingRow,
  Business,
  Contact,
  ContactBalance,
  Currency,
  ExchangeRate,
  Overview,
  ReceiptRow,
  Report,
  StaffRow,
  Transaction,
  TransactionRow,
  AssistantMessage,
} from "@/components/app-types";

type User = { id: string; name: string; email: string; preferredLanguage?: string };
type Page = "overview" | "assistant" | "exchange" | "stock" | "transactions" | "approvals" | "accounts" | "customers" | "suppliers" | "bookings" | "income" | "reports" | "receipts" | "staff" | "audit" | "notifications" | "settings" | "language";
type Toast = { message: string; kind: "success" | "error" | "info" };
type ContactTarget = { id: string; kind: "customer" | "supplier" };
type PaymentTarget = { contact: Contact; kind: "customer_payment" | "supplier_payment"; balances: ContactBalance[] };
type AssistantConfig = { configured: boolean; provider: string; model: string | null; missing: string[]; speechInput: string; speechOutput: string };

type SettingsDraft = {
  name: string; baseCurrency: string; timezone: string; address: string; phone: string; email: string; logoUrl: string;
  primaryColor: string; accentColor: string; terms: string;
};

const en = {
  overview: "Overview", assistant: "AI assistant", exchange: "Currency exchange", stock: "Currency stock", transactions: "Transactions", approvals: "Pending approvals",
  accounts: "Cash & bank", customers: "Customers", suppliers: "Suppliers", bookings: "Travel bookings", income: "Income & expenses", reports: "Reports",
  receipts: "Receipts & documents", staff: "Staff & permissions", audit: "Audit log", notifications: "Notifications", settings: "Business settings", language: "Language & app",
  workspace: "WORKSPACE", operations: "OPERATIONS", records: "RECORDS", administration: "ADMINISTRATION", today: "Today", addBusiness: "Add workspace", signOut: "Sign out",
};
const bn = {
  overview: "সারসংক্ষেপ", assistant: "এআই সহকারী", exchange: "মুদ্রা বিনিময়", stock: "মুদ্রার মজুত", transactions: "লেনদেন", approvals: "অনুমোদন বাকি",
  accounts: "নগদ ও ব্যাংক", customers: "গ্রাহক", suppliers: "সরবরাহকারী", bookings: "ভ্রমণ বুকিং", income: "আয় ও ব্যয়", reports: "রিপোর্ট",
  receipts: "রসিদ ও নথি", staff: "কর্মী ও অনুমতি", audit: "অডিট লগ", notifications: "বিজ্ঞপ্তি", settings: "ব্যবসার সেটিংস", language: "ভাষা ও অ্যাপ",
  workspace: "কর্মক্ষেত্র", operations: "কার্যক্রম", records: "রেকর্ড", administration: "প্রশাসন", today: "আজ", addBusiness: "কর্মক্ষেত্র যোগ করুন", signOut: "সাইন আউট",
};
const ar = {
  overview: "نظرة عامة", assistant: "المساعد الذكي", exchange: "صرف العملات", stock: "المخزون النقدي", transactions: "المعاملات", approvals: "الموافقات المعلقة",
  accounts: "النقد والبنك", customers: "العملاء", suppliers: "الموردون", bookings: "حجوزات السفر", income: "الإيرادات والمصروفات", reports: "التقارير",
  receipts: "الإيصالات والمستندات", staff: "الموظفون والصلاحيات", audit: "سجل التدقيق", notifications: "التنبيهات", settings: "إعدادات الأعمال", language: "اللغة والتطبيق",
  workspace: "مساحة العمل", operations: "العمليات", records: "السجلات", administration: "الإدارة", today: "اليوم", addBusiness: "إضافة مساحة", signOut: "تسجيل الخروج",
};
const pageCopy: Record<Page, { title: string; subtitle: string }> = {
  overview: { title: "Overview", subtitle: "A calm, current view of your business—grounded in approved records." },
  assistant: { title: "AI assistant", subtitle: "Ask in English, Bengali, or Arabic. Drafts never post without owner approval." },
  exchange: { title: "Currency exchange", subtitle: "Create owner-review drafts with explicit currency pairs and settlement details." },
  stock: { title: "Currency stock", subtitle: "Approved inventory valued using the documented moving weighted-average method." },
  transactions: { title: "Transactions", subtitle: "Search, review, and trace every draft, posting, and correction." },
  approvals: { title: "Pending approvals", subtitle: "Review the exact accounting impact before any financial posting." },
  accounts: { title: "Cash & bank accounts", subtitle: "Account balances remain separated by currency; reporting values use explicit rates." },
  customers: { title: "Customers", subtitle: "Customer records, currency-specific receivables, and statements." },
  suppliers: { title: "Suppliers", subtitle: "Supplier records, currency-specific payables, and statements." },
  bookings: { title: "Travel bookings", subtitle: "Ticket and Umrah service status is recorded explicitly—not assumed." },
  income: { title: "Income & expenses", subtitle: "Create reviewable drafts and track partial settlement correctly." },
  reports: { title: "Reports", subtitle: "Income, costs, realized gains, profit, and cash flow from posted ledger entries." },
  receipts: { title: "Receipts & documents", subtitle: "Final, branded customer documents created from approved persisted transactions." },
  staff: { title: "Staff & permissions", subtitle: "Workspace access is scoped per business. Non-owners cannot approve postings." },
  audit: { title: "Audit log", subtitle: "A durable trail of owner decisions, drafts, settings, and access changes." },
  notifications: { title: "Notifications", subtitle: "Approval work, recent changes, and actionable business activity." },
  settings: { title: "Business settings", subtitle: "Editable identity, reporting currency, contacts, and brand assets." },
  language: { title: "Language & app", subtitle: "Choose the workspace language and review privacy and AI configuration." },
};

const iconForPage: Record<Page, "home" | "sparkles" | "exchange" | "coins" | "receipt" | "users" | "plane" | "chart" | "bank" | "settings" | "bell" | "shield" | "globe"> = {
  overview: "home", assistant: "sparkles", exchange: "exchange", stock: "coins", transactions: "receipt", approvals: "shield", accounts: "bank",
  customers: "users", suppliers: "briefcase" as "shield", bookings: "plane", income: "wallet" as "bank", reports: "chart", receipts: "file" as "receipt",
  staff: "users", audit: "clipboard" as "receipt", notifications: "bell", settings: "settings", language: "globe",
};

function logoFor(business: Business, dark = false): string {
  if (business.logoUrl && !business.logoUrl.startsWith("/branding/")) return business.logoUrl;
  if (business.category === "travel_agency") return dark ? "/branding/qasemi-tours-and-travels-dark.svg" : "/branding/qasemi-tours-and-travels.svg";
  return dark ? "/branding/osama-trusted-solutions-dark.svg" : "/branding/osama-trusted-solutions.svg";
}

function transactionName(transaction: Transaction): string {
  const names: Record<string, string> = {
    fx_purchase: "Currency purchase", fx_sale: "Currency sale", ticket: "Ticket booking", umrah: "Umrah service",
    income: "Other income", expense: "Operating expense", customer_payment: "Customer payment", supplier_payment: "Supplier payment", reversal: "Reversal",
  };
  return names[transaction.kind] ?? transaction.kind.replaceAll("_", " ");
}

function absoluteValue(value: string | null | undefined): string {
  try { const parsed = parseDecimal(value ?? "0"); return decimalString(parsed < BigInt(0) ? -parsed : parsed); }
  catch { return value ?? "0"; }
}

function CurrencyValue({ value, currency }: { value: string | null | undefined; currency: string }) {
  return <>{value ?? "0"} <span className="kpi-currency">{currency}</span></>;
}

function TransactionTable({ rows, onOpen }: { rows: TransactionRow[]; onOpen: (transaction: Transaction) => void }) {
  if (!rows.length) return <EmptyState icon="receipt" title="No transactions yet" description="Create a draft to start an auditable transaction history. Drafts do not affect balances or inventory." />;
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>Transaction</th><th>Date</th><th>Counterparty / details</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
    {rows.map(({ transaction, customerName, supplierName }) => <tr key={transaction.id}>
      <td><span className="table-primary">{transactionName(transaction)}</span><span className="table-secondary">{transaction.receiptNumber || transaction.id.slice(0, 8).toUpperCase()}</span></td>
      <td>{new Date(transaction.transactionDate).toLocaleDateString()}</td>
      <td><span className="table-primary">{customerName || supplierName || transaction.location || transaction.description || "—"}</span>{transaction.quantity && <span className="table-secondary">{transaction.quantity} {transaction.tradedCurrency} at {transaction.rate} {transaction.settlementCurrency}/{transaction.tradedCurrency}</span>}</td>
      <td><span className="table-primary">{transaction.totalAmount ?? "—"} {transaction.settlementCurrency}</span>{transaction.paymentAmount && transaction.paymentAmount !== "0" && <span className="table-secondary">Paid {transaction.paymentAmount} {transaction.settlementCurrency}</span>}</td>
      <td><StatusPill status={transaction.reversedById ? "rejected" : transaction.status} label={transaction.reversedById ? "reversed" : transaction.status} /></td>
      <td><button className="btn btn-quiet btn-sm" type="button" onClick={() => onOpen(transaction)} aria-label="Open transaction"><Icon name="arrow" size={14} /></button></td>
    </tr>)}
  </tbody></table></div>;
}

function KpiCard({ label, value, currency, meta, icon, color = "#167c72", wash = "#edf6f2" }: { label: string; value: string; currency?: string; meta?: string; icon: IconName; color?: string; wash?: string }) {
  return <div className="panel kpi-card" style={{ "--accent": color, "--wash": wash } as React.CSSProperties}><div className="kpi-top"><span className="kpi-label">{label}</span><span className="kpi-icon"><Icon name={icon} size={16} /></span></div><div className="kpi-value">{value}{currency && <span className="kpi-currency">{currency}</span>}</div>{meta && <div className="kpi-meta">{meta}</div>}</div>;
}

function dateISO(date: Date) { return date.toISOString().slice(0, 10); }

export default function WorkspaceApp() {
  const [bootLoading, setBootLoading] = useState(true);
  const [bootError, setBootError] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState("");
  const [page, setPage] = useState<Page>("overview");
  const [language, setLanguage] = useState<"en" | "bn" | "ar">("en");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [customers, setCustomers] = useState<Contact[]>([]);
  const [suppliers, setSuppliers] = useState<Contact[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [receiptRows, setReceiptRows] = useState<ReceiptRow[]>([]);
  const [notifications, setNotifications] = useState<{ pendingApprovals: number; recentEvents: AuditEvent[] }>({ pendingApprovals: 0, recentEvents: [] });
  const [assistantConfig, setAssistantConfig] = useState<AssistantConfig | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [transactionFilter, setTransactionFilter] = useState("all");
  const [reportFrom, setReportFrom] = useState(dateISO(new Date(Date.UTC(new Date().getFullYear(), 0, 1))));
  const [reportTo, setReportTo] = useState(dateISO(new Date()));
  const [consolidated, setConsolidated] = useState<Array<{ business: string; report: Report }> | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsSaved, setSettingsSaved] = useState(false);

  const [showExchange, setShowExchange] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [showIncome, setShowIncome] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showBusiness, setShowBusiness] = useState(false);
  const [showCurrency, setShowCurrency] = useState(false);
  const [showContactForm, setShowContactForm] = useState<"customer" | "supplier" | null>(null);
  const [showStaff, setShowStaff] = useState(false);
  const [reviewId, setReviewId] = useState("");
  const [receiptId, setReceiptId] = useState("");
  const [contactTarget, setContactTarget] = useState<ContactTarget | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<PaymentTarget | null>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");

  const activeBusiness = useMemo(() => businesses.find((business) => business.id === selectedBusinessId) ?? businesses[0] ?? null, [businesses, selectedBusinessId]);
  const isOwner = activeBusiness?.role === "owner";
  const copy = language === "bn" ? bn : language === "ar" ? ar : en;
  const tr = (key: keyof typeof en) => copy[key] ?? en[key];
  const pendingCount = overview?.pendingApprovals ?? notifications.pendingApprovals;

  const showToast = useCallback((message: string, kind: Toast["kind"] = "info") => {
    setToast({ message, kind });
  }, []);

  const hydrateAuth = useCallback(async () => {
    const result = await apiRequest<{ user: User | null; businesses: Business[] }>("auth/me");
    setUser(result.user);
    setBusinesses(result.businesses);
    setSetupRequired(false);
    if (result.user && result.businesses.length) {
      const stored = window.localStorage.getItem("business-ledger.active-workspace");
      const valid = result.businesses.find((business) => business.id === stored);
      const preferred = valid?.id ?? result.businesses[0].id;
      setSelectedBusinessId(preferred);
      window.localStorage.setItem("business-ledger.active-workspace", preferred);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function boot() {
      setBootLoading(true); setBootError("");
      try {
        const state = await apiRequest<{ setupRequired: boolean; ai: AssistantConfig }>("auth/state");
        if (!active) return;
        setSetupRequired(state.setupRequired);
        setAssistantConfig(state.ai);
        const session = await apiRequest<{ user: User | null; businesses: Business[] }>("auth/me");
        if (!active) return;
        setUser(session.user);
        setBusinesses(session.businesses);
        if (session.user && session.businesses.length) {
          const stored = window.localStorage.getItem("business-ledger.active-workspace");
          const preferred = session.businesses.find((business) => business.id === stored)?.id ?? session.businesses[0].id;
          setSelectedBusinessId(preferred);
          window.localStorage.setItem("business-ledger.active-workspace", preferred);
        }
        const savedLanguage = window.localStorage.getItem("business-ledger.language");
        if (savedLanguage === "bn" || savedLanguage === "ar" || savedLanguage === "en") setLanguage(savedLanguage);
      } catch (cause) {
        if (active) setBootError(cause instanceof Error ? cause.message : "The workspace could not be initialized.");
      } finally { if (active) setBootLoading(false); }
    }
    void boot();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("business-ledger.language", language);
    document.documentElement.lang = language === "bn" ? "bn" : language === "ar" ? "ar" : "en";
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4300);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!activeBusiness || !user) return;
    let current = true;
    const load = async () => {
      setPageLoading(true);
      const requests: Array<Promise<void>> = [];
      const addRequest = <T,>(route: string, apply: (result: T) => void, params?: Record<string, string | number | undefined>) => {
        requests.push(apiRequest<T>(route, { businessId: activeBusiness.id, params }).then((result) => { if (current) apply(result); }));
      };
      const needsTransactions = ["overview", "exchange", "stock", "transactions", "approvals", "income", "receipts"].includes(page);
      const needsInputs = ["exchange", "income", "bookings", "customers", "suppliers", "accounts", "settings"].includes(page);
      if (["overview", "exchange", "stock", "transactions", "approvals", "accounts", "bookings", "income", "reports", "receipts", "notifications"].includes(page)) {
        if (["overview", "exchange", "stock", "reports", "notifications"].includes(page)) addRequest<Overview>("overview", setOverview);
      }
      if (needsTransactions) addRequest<{ transactions: TransactionRow[] }>("transactions", (data) => setTransactions(data.transactions));
      if (["exchange", "accounts", "settings", "income", "bookings"].includes(page)) addRequest<{ accounts: Account[] }>("accounts", (data) => setAccounts(data.accounts));
      if (["exchange", "settings", "income", "bookings"].includes(page)) addRequest<{ currencies: Currency[] }>("currencies", (data) => setCurrencies(data.currencies));
      if (["exchange", "income", "bookings", "customers"].includes(page)) addRequest<{ contacts: Contact[] }>("customers", (data) => setCustomers(data.contacts));
      if (["exchange", "income", "bookings", "suppliers"].includes(page)) addRequest<{ contacts: Contact[] }>("suppliers", (data) => setSuppliers(data.contacts));
      if (page === "bookings") addRequest<{ bookings: BookingRow[] }>("bookings", (data) => setBookings(data.bookings));
      if (page === "reports") addRequest<Report>("reports", setReport);
      if (page === "receipts") addRequest<{ receipts: ReceiptRow[] }>("receipts", (data) => setReceiptRows(data.receipts));
      if (page === "staff" || page === "settings") addRequest<{ staff: StaffRow[] }>("staff", (data) => setStaff(data.staff));
      if (page === "settings") addRequest<{ rates: ExchangeRate[] }>("rates", (data) => setRates(data.rates));
      if (page === "audit") addRequest<{ events: AuditEvent[] }>("audit", (data) => setAuditEvents(data.events));
      if (page === "notifications") addRequest<{ pendingApprovals: number; recentEvents: AuditEvent[] }>("notifications", setNotifications);
      if (page === "assistant" || page === "settings" || page === "language") addRequest<AssistantConfig>("assistant/config", setAssistantConfig);
      if (needsInputs) setSettingsSaved(false);
      try { await Promise.all(requests); }
      catch (cause) { if (current) showToast(cause instanceof Error ? cause.message : "Could not load this section.", "error"); }
      finally { if (current) setPageLoading(false); }
    };
    void load();
    return () => { current = false; };
  }, [activeBusiness?.id, page, refreshCounter, user?.id, showToast]);

  useEffect(() => {
    if (!activeBusiness || page !== "settings") return;
    const settings = (activeBusiness.settings ?? {}) as Record<string, unknown>;
    setSettingsDraft({
      name: activeBusiness.name,
      baseCurrency: activeBusiness.baseCurrency,
      timezone: activeBusiness.timezone || "Africa/Cairo",
      address: activeBusiness.address ?? "",
      phone: activeBusiness.phone ?? "",
      email: activeBusiness.email ?? "",
      logoUrl: activeBusiness.logoUrl ?? "",
      primaryColor: activeBusiness.primaryColor || "#13243d",
      accentColor: activeBusiness.accentColor || "#c9a66b",
      terms: typeof settings.terms === "string" ? settings.terms : "",
    });
  }, [activeBusiness?.id, page, refreshCounter]);

  const refresh = () => setRefreshCounter((value) => value + 1);

  async function loadFormDependencies() {
    if (!activeBusiness) return;
    try {
      const [currencyData, accountData, customerData, supplierData] = await Promise.all([
        apiRequest<{ currencies: Currency[] }>("currencies", { businessId: activeBusiness.id }),
        apiRequest<{ accounts: Account[] }>("accounts", { businessId: activeBusiness.id }),
        apiRequest<{ contacts: Contact[] }>("customers", { businessId: activeBusiness.id }),
        apiRequest<{ contacts: Contact[] }>("suppliers", { businessId: activeBusiness.id }),
      ]);
      setCurrencies(currencyData.currencies); setAccounts(accountData.accounts); setCustomers(customerData.contacts); setSuppliers(supplierData.contacts);
    } catch (cause) { showToast(cause instanceof Error ? cause.message : "Could not load form options.", "error"); }
  }

  async function openExchange() { await loadFormDependencies(); setShowExchange(true); }
  async function openBooking() { await loadFormDependencies(); setShowBooking(true); }
  async function openIncome() { await loadFormDependencies(); setShowIncome(true); }
  async function openAccount() {
    if (!activeBusiness) return;
    try { const data = await apiRequest<{ currencies: Currency[] }>("currencies", { businessId: activeBusiness.id }); setCurrencies(data.currencies); setShowAccount(true); }
    catch (cause) { showToast(cause instanceof Error ? cause.message : "Could not load accounts.", "error"); }
  }

  async function handleCreated(transaction: Transaction) {
    setShowExchange(false); setShowBooking(false); setShowIncome(false); setPaymentTarget(null);
    setPage("approvals"); setReviewId(transaction.id); refresh();
    showToast("Draft saved. No account, stock, or balance changed until owner approval.", "success");
  }

  async function signOut() {
    try { await apiRequest("auth/logout", { method: "POST", body: {} }); }
    catch { /* local view is still cleared if the server session expired */ }
    setUser(null); setBusinesses([]); setSelectedBusinessId(""); setPage("overview");
    showToast("You have signed out.", "success");
  }

  function selectBusiness(business: Business) {
    setSelectedBusinessId(business.id);
    window.localStorage.setItem("business-ledger.active-workspace", business.id);
    setSwitcherOpen(false); setMobileNavOpen(false); setPage("overview"); setOverview(null); setTransactions([]); refresh();
  }

  function openTransaction(transaction: Transaction) { setReviewId(transaction.id); }
  function updateTransaction(transaction: Transaction) {
    setTransactions((rows) => rows.map((row) => row.transaction.id === transaction.id ? { ...row, transaction } : row));
    refresh();
  }

  async function openContact(target: ContactTarget) {
    setContactTarget(target);
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeBusiness || !settingsDraft) return;
    setSettingsSaving(true); setSettingsError(""); setSettingsSaved(false);
    try {
      const result = await apiRequest<{ business: Business }>(`businesses/${activeBusiness.id}`, {
        method: "PATCH", businessId: activeBusiness.id, body: settingsDraft,
      });
      setBusinesses((current) => current.map((business) => business.id === result.business.id ? { ...business, ...result.business, role: business.role, permissions: business.permissions } : business));
      setSettingsSaved(true); showToast("Business identity and branding saved.", "success");
    } catch (cause) { setSettingsError(cause instanceof Error ? cause.message : "Settings could not be saved."); }
    finally { setSettingsSaving(false); }
  }

  async function loadReport() {
    if (!activeBusiness) return;
    try {
      const from = reportFrom ? `${reportFrom}T00:00:00.000Z` : undefined;
      const to = reportTo ? `${reportTo}T23:59:59.999Z` : undefined;
      const value = await apiRequest<Report>("reports", { businessId: activeBusiness.id, params: { from, to } });
      setReport(value);
    } catch (cause) { showToast(cause instanceof Error ? cause.message : "Report could not be loaded.", "error"); }
  }

  async function loadConsolidated() {
    if (!activeBusiness) return;
    try {
      const from = reportFrom ? `${reportFrom}T00:00:00.000Z` : undefined;
      const to = reportTo ? `${reportTo}T23:59:59.999Z` : undefined;
      const value = await apiRequest<{ policy: string; reports: Array<{ business: string } & Report> }>("reports/consolidated", { params: { from, to } });
      setConsolidated(value.reports.map(({ business, ...businessReport }) => ({ business, report: businessReport })));
    } catch (cause) { showToast(cause instanceof Error ? cause.message : "Combined report could not be loaded.", "error"); }
  }

  function selectSearch(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && globalSearch.trim()) {
      setListQuery(globalSearch.trim()); setTransactionFilter("all"); setPage("transactions"); setMobileNavOpen(false);
    }
  }

  const filteredTransactions = useMemo(() => {
    return transactions.filter(({ transaction, customerName, supplierName }) => {
      const statusMatches = transactionFilter === "all" || transaction.status === transactionFilter;
      const term = listQuery.toLowerCase();
      const termMatches = !term || [transaction.kind, transaction.description, transaction.location, transaction.receiptNumber, customerName, supplierName, transaction.tradedCurrency, transaction.settlementCurrency].some((value) => String(value ?? "").toLowerCase().includes(term));
      return statusMatches && termMatches;
    });
  }, [transactions, transactionFilter, listQuery]);

  function pageTitle(): string {
    const map: Record<Page, keyof typeof en> = {
      overview: "overview", assistant: "assistant", exchange: "exchange", stock: "stock", transactions: "transactions", approvals: "approvals",
      accounts: "accounts", customers: "customers", suppliers: "suppliers", bookings: "bookings", income: "income", reports: "reports",
      receipts: "receipts", staff: "staff", audit: "audit", notifications: "notifications", settings: "settings", language: "language",
    };
    return tr(map[page]);
  }

  if (bootLoading) return <div className="min-h-screen grid place-items-center"><div className="panel panel-pad" style={{ display: "flex", alignItems: "center", gap: 12 }}><span className="spinner" /><span style={{ color: "#738096", fontSize: 12 }}>Preparing your private workspace…</span></div></div>;
  if (!user) return <><AuthPanel setupRequired={setupRequired} onAuthenticated={hydrateAuth} />{bootError && <div className="toast-stack"><div className="toast error">{bootError}</div></div>}</>;
  if (!activeBusiness) return <div className="min-h-screen grid place-items-center"><div className="panel panel-pad"><h2>No workspace access</h2><p className="subtle">This account is not assigned to a business workspace.</p><button type="button" className="btn btn-outline" onClick={signOut}>Sign out</button></div></div>;

  const navigation: Array<{ group: keyof typeof en; items: Page[] }> = [
    { group: "workspace", items: ["overview", "assistant"] },
    { group: "operations", items: ["exchange", "stock", "bookings", "income", "transactions", "approvals"] },
    { group: "records", items: ["accounts", "customers", "suppliers", "receipts", "reports"] },
    { group: "administration", items: ["staff", "audit", "notifications", "settings", "language"] },
  ];
  const menu = <aside className={`sidebar ${mobileNavOpen ? "open" : ""}`}>
    <div className="sidebar-brand"><img src={logoFor(activeBusiness, true)} alt={activeBusiness.name} /></div>
    <div style={{ padding: "0 5px", position: "relative" }}>
      <div className="sidebar-caption" style={{ paddingTop: 0 }}>{tr("workspace")}</div>
      <button className="workspace-select" type="button" onClick={() => setSwitcherOpen((current) => !current)}>
        <span className="workspace-mark">{activeBusiness.category === "travel_agency" ? "QT" : "OTS"}</span>
        <span style={{ minWidth: 0, flex: 1 }}><strong>{activeBusiness.name}</strong><small>{activeBusiness.category === "currency_exchange" ? "Currency exchange" : activeBusiness.category === "travel_agency" ? "Travel services" : "Business workspace"}</small></span>
        <Icon name="chevron" size={14} />
      </button>
      {switcherOpen && <div className="workspace-menu">{businesses.map((business) => <button key={business.id} type="button" onClick={() => selectBusiness(business)}><span>{business.name}</span><small>{business.baseCurrency} reporting</small></button>)}<button className="workspace-add" type="button" onClick={() => { setSwitcherOpen(false); setShowBusiness(true); }}><Icon name="plus" size={13} />{tr("addBusiness")}</button></div>}
    </div>
    <div className="sidebar-nav-scroll">{navigation.map((section) => <div key={section.group}><div className="sidebar-caption">{tr(section.group)}</div><nav className="nav-list" aria-label={tr(section.group)}>{section.items.map((navPage) => {
      if (navPage === "exchange" && activeBusiness.category === "travel_agency") return null;
      if (navPage === "bookings" && activeBusiness.category === "currency_exchange") return null;
      const titleKey = navPage as keyof typeof en;
      return <button key={navPage} className={`nav-item ${page === navPage ? "active" : ""}`} type="button" onClick={() => { setPage(navPage); setMobileNavOpen(false); }}><Icon name={iconForPage[navPage]} size={16} /><span>{tr(titleKey)}</span>{navPage === "approvals" && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}</button>;
    })}</nav></div>)}</div>
    <div className="sidebar-bottom"><div className="sidebar-note"><b><Icon name="shield" size={14} />Approval-first ledger</b><p>AI can draft and calculate. Only the authenticated owner can post or reverse finances.</p></div><div className="user-card"><span className="avatar">{initials(user.name)}</span><span style={{ minWidth: 0, flex: 1 }}><strong>{user.name}</strong><small>{user.email}</small></span><button className="icon-button" type="button" onClick={signOut} aria-label={tr("signOut")} title={tr("signOut")} style={{ background: "transparent", borderColor: "transparent", color: "#9aa9bc" }}><Icon name="logout" size={15} /></button></div></div>
  </aside>;

  const pageCopyText = pageCopy[page];
  const ownerBadge = activeBusiness.role === "owner" ? "Workspace owner" : `${activeBusiness.role ?? "staff"} access`;
  const cashAccounts = accounts.filter((account) => ["cash", "bank"].includes(account.type));

  return <div className={`workspace-shell ${language === "ar" ? "rtl" : ""}`} dir={language === "ar" ? "rtl" : "ltr"} lang={language}>
    {menu}
    {mobileNavOpen && <div className="sidebar-overlay" onClick={() => setMobileNavOpen(false)} />}
    <div className="app-main">
      <header className="topbar">
        <div className="topbar-left">
          <button type="button" className="icon-button mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Icon name="menu" size={17} /></button>
          <div><div className="crumb">{activeBusiness.name}</div><div className="page-title">{pageTitle()}</div></div>
        </div>
        <div className="topbar-right">
          <div className="search-box"><Icon name="search" size={15} /><input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} onKeyDown={selectSearch} placeholder="Search transactions…" aria-label="Search transactions" /></div>
          <span className="topbar-date">{new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(new Date())}</span>
          <button type="button" className="icon-button" onClick={() => setPage("notifications")} aria-label="Notifications"><Icon name="bell" size={16} />{pendingCount > 0 && <span className="notification-dot" />}</button>
          <span className="avatar" style={{ width: 32, height: 32 }}>{initials(user.name)}</span>
        </div>
      </header>

      <main className="content-wrap">
        <div className="page-heading">
          <div><h1>{pageCopyText.title}</h1><p>{pageCopyText.subtitle}</p></div>
          <div className="heading-actions">
            {page === "overview" && <>
              <button type="button" className="btn btn-outline" onClick={() => { void loadFormDependencies(); setPage("assistant"); }}><Icon name="sparkles" size={15} />Ask assistant</button>
              <button type="button" className="btn btn-primary" onClick={activeBusiness.category === "travel_agency" ? openBooking : openExchange}><Icon name="plus" size={15} />{activeBusiness.category === "travel_agency" ? "New booking draft" : "Create transaction"}</button>
            </>}
            {page === "exchange" && <button type="button" className="btn btn-primary" onClick={openExchange}><Icon name="plus" size={15} />New exchange draft</button>}
            {page === "bookings" && <button type="button" className="btn btn-primary" onClick={openBooking}><Icon name="plus" size={15} />Create booking draft</button>}
            {page === "customers" && <button type="button" className="btn btn-primary" onClick={() => setShowContactForm("customer")}><Icon name="plus" size={15} />Add customer</button>}
            {page === "suppliers" && <button type="button" className="btn btn-primary" onClick={() => setShowContactForm("supplier")}><Icon name="plus" size={15} />Add supplier</button>}
            {page === "accounts" && <button type="button" className="btn btn-primary" onClick={openAccount}><Icon name="plus" size={15} />Add account</button>}
            {page === "income" && <button type="button" className="btn btn-primary" onClick={openIncome}><Icon name="plus" size={15} />New income / expense</button>}
            {page === "staff" && isOwner && <button type="button" className="btn btn-primary" onClick={() => setShowStaff(true)}><Icon name="plus" size={15} />Add staff</button>}
            {page === "settings" && isOwner && <button type="button" className="btn btn-outline" onClick={() => setShowBusiness(true)}><Icon name="building" size={15} />Add workspace</button>}
          </div>
        </div>
        {pageLoading && <div className="callout info" style={{ marginBottom: 14 }}><span className="spinner" />Loading authorized workspace records…</div>}

        {page === "overview" && <>
          {!overview ? <div className="panel"><EmptyState icon="chart" title="Your dashboard is loading" description="Only posted ledger records appear in financial totals. Create your first draft after account setup." /></div> : <>
            <div className="kpi-grid">
              <KpiCard label="Net profit · today" value={overview.today.netProfit} currency={overview.today.currency} icon="chart" meta={`Revenue ${overview.today.revenue} · Expenses ${overview.today.expenses}`} color="#147d73" wash="#ecf6f2" />
              <KpiCard label="Cash movement · today" value={overview.today.cashFlow} currency={overview.today.currency} icon="wallet" meta={`Business day in ${overview.today.timezone}`} color="#436c9f" wash="#edf3fa" />
              <KpiCard label="Approved currency stock" value={String(overview.stocks.length)} meta={overview.stocks.length ? overview.stocks.map((stock) => stock.currency).join(" · ") : "No posted inventory yet"} icon="coins" color="#a98236" wash="#f8f2e6" />
              <KpiCard label="Pending owner approvals" value={String(overview.pendingApprovals)} meta="Drafts are not posted to balances" icon="shield" color="#bb7c36" wash="#fbf3e8" />
            </div>
            <div className="dashboard-grid">
              <section className="panel panel-pad"><SectionHeading title="Recent activity" subtitle="Newest records in this business workspace" action={<button type="button" className="btn btn-quiet btn-sm" onClick={() => setPage("transactions")}>All transactions <Icon name="arrow" size={13} /></button>} />
                <TransactionTable rows={transactions.slice(0, 6)} onOpen={openTransaction} />
              </section>
              <section className="panel panel-pad"><SectionHeading title="Quick actions" subtitle="Frequently used owner workflows" />
                <div className="quick-actions">
                  <button type="button" className="quick-action" onClick={() => { void loadFormDependencies(); setPage("assistant"); }}><span><Icon name="sparkles" size={15} /></span><strong>Ask assistant</strong><small>Ask about your records</small></button>
                  <button type="button" className="quick-action" onClick={activeBusiness.category === "travel_agency" ? openBooking : openExchange}><span><Icon name="exchange" size={15} /></span><strong>Create transaction</strong><small>Build an unposted draft</small></button>
                  <button type="button" className="quick-action" onClick={() => setPage("approvals")}><span><Icon name="shield" size={15} /></span><strong>Review approvals</strong><small>{overview.pendingApprovals} waiting for owner</small></button>
                  <button type="button" className="quick-action" onClick={() => setPage("receipts")}><span><Icon name="receipt" size={15} /></span><strong>Create receipt</strong><small>Use an existing posted record</small></button>
                </div>
                <div className="callout info" style={{ marginTop: 14 }}><Icon name="shield" />No AI draft can change a cash account, customer balance, or stock before owner approval.</div>
              </section>
            </div>
            <div className="dashboard-lower">
              <section className="panel panel-pad"><SectionHeading title="Currency stock" subtitle={`Weighted-average valuation in ${activeBusiness.baseCurrency}; currencies are never mixed.`} action={<button className="btn btn-quiet btn-sm" type="button" onClick={() => setPage("stock")}>Open stock <Icon name="arrow" size={13} /></button>} />
                {overview.stocks.length === 0 ? <EmptyState icon="coins" title="No approved stock" description="Approved purchases add currency inventory. Draft purchases do not change on-hand stock." action={<button type="button" className="btn btn-outline btn-sm" onClick={openExchange}>Create purchase draft</button>} /> : <div className="stock-list">{overview.stocks.slice(0, 5).map((stock) => <div className="stock-row" key={stock.currency}><span className="currency-badge">{stock.currency}</span><div className="stock-info"><strong>Average cost · {stock.currency}</strong><small>{stock.averageCost} {stock.baseCurrency} per {stock.currency}</small></div><div className="stock-qty">{stock.quantity}<small>{stock.currency}</small></div></div>)}</div>}
              </section>
              <section className="panel panel-pad"><SectionHeading title="Workspace health" subtitle="Separate books for each business" />
                <div className="list-stack">
                  <div className="list-row"><span className="row-icon"><Icon name="users" size={16} /></span><div className="row-main"><strong>Customers</strong><small>Business-specific relationships</small></div><span className="row-value">{overview.counts.customers}</span></div>
                  <div className="list-row"><span className="row-icon" style={{ background: "#f5f2e9", color: "#9b7c3c" }}><Icon name="briefcase" size={16} /></span><div className="row-main"><strong>Suppliers</strong><small>Payments tracked per currency</small></div><span className="row-value">{overview.counts.suppliers}</span></div>
                  <div className="list-row"><span className="row-icon" style={{ background: "#eef2f8", color: "#57739c" }}><Icon name="plane" size={16} /></span><div className="row-main"><strong>Travel bookings</strong><small>Quotation, reserved, issued, paid</small></div><span className="row-value">{overview.counts.bookings}</span></div>
                </div>
                <button type="button" className="btn btn-outline btn-wide" style={{ marginTop: 12 }} onClick={() => setPage("reports")}><Icon name="chart" size={15} />Open profit & cash-flow reports</button>
              </section>
            </div>
          </>}
        </>}

        {page === "assistant" && <AssistantView business={activeBusiness} language={language} config={assistantConfig} messages={messages} setMessages={setMessages} input={assistantInput} setInput={setAssistantInput} busy={assistantBusy} setBusy={setAssistantBusy} onToast={showToast} onOpenDraft={(id) => { setReviewId(id); setPage("approvals"); }} listening={voiceListening} setListening={setVoiceListening} speakEnabled={ttsEnabled} setSpeakEnabled={setTtsEnabled} />}

        {page === "exchange" && <>
          <div className="panel panel-pad" style={{ marginBottom: 14 }}><SectionHeading title="Pair and settlement preview" subtitle="Enter the rate and payment details explicitly; the server recalculates every total before approval." />
            <div className="callout info"><Icon name="exchange" />Weighted-average inventory cost is based on posted purchase and reversal journals. Currency sales are blocked if approved stock is insufficient.</div>
          </div>
          <section className="panel panel-pad"><SectionHeading title="Recent exchange drafts and postings" subtitle="Cash, bank, and stock changes appear only after the owner approves." />
            <TransactionTable rows={transactions.filter((row) => row.transaction.kind.startsWith("fx_") || row.transaction.kind === "reversal")} onOpen={openTransaction} />
          </section>
        </>}

        {page === "stock" && <>
          <div className="panel panel-pad" style={{ marginBottom: 15 }}><SectionHeading title="Approved currency inventory" subtitle={`Moving weighted-average cost · reporting currency ${activeBusiness.baseCurrency}`} action={<button type="button" className="btn btn-primary btn-sm" onClick={openExchange}><Icon name="plus" size={14} />Record purchase draft</button>} />
            {overview?.stocks.length ? <div className="stock-list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 11 }}>{overview.stocks.map((stock) => <div className="panel" key={stock.currency} style={{ padding: 14, boxShadow: "none", background: "#fbfcfb" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span className="currency-badge">{stock.currency}</span><span className="eyebrow">Available stock</span></div><div style={{ marginTop: 13, fontSize: 21, fontWeight: 750, color: "#23374d" }}>{stock.quantity} <span style={{ fontSize: 11, color: "#7e8b9a" }}>{stock.currency}</span></div><div className="field-hint" style={{ marginTop: 7 }}>Carrying value · {stock.carryingValue} {stock.baseCurrency}</div><div className="field-hint">Average cost · {stock.averageCost} {stock.baseCurrency} / {stock.currency}</div></div>)}</div> : <EmptyState icon="coins" title="No posted currency inventory" description="Approved currency purchases create stock. You can record multiple lots at different rates; partial sales use the moving weighted average." action={<button type="button" className="btn btn-primary btn-sm" onClick={openExchange}>Create purchase draft</button>} />}
          </div>
          <section className="panel panel-pad"><SectionHeading title="Purchase lot history" subtitle="Original approved purchases remain immutable and auditable. Moving weighted average values the combined stock; it does not assign FIFO lot residue." />
            <TransactionTable rows={transactions.filter((row) => row.transaction.kind === "fx_purchase")} onOpen={openTransaction} />
          </section>
        </>}

        {(page === "transactions" || page === "approvals") && <section className="panel panel-pad">
          {page === "approvals" ? <>
            <SectionHeading title="Owner decision queue" subtitle={isOwner ? "Review the details, adjust a draft, then approve or reject it." : "You can review drafts; only the authenticated owner can post financial changes."} />
            {!isOwner && <div className="callout info" style={{ marginBottom: 13 }}><Icon name="shield" />Your role cannot approve, reject, or reverse financial postings.</div>}
            <TransactionTable rows={transactions.filter((row) => row.transaction.status === "draft")} onOpen={openTransaction} />
          </> : <>
            <div className="toolbar"><div className="filter-row">{["all", "draft", "posted", "rejected"].map((filter) => <button key={filter} className={`filter-chip ${transactionFilter === filter ? "active" : ""}`} type="button" onClick={() => setTransactionFilter(filter)}>{filter === "all" ? "All records" : filter}</button>)}</div><div className="search-box" style={{ width: 250 }}><Icon name="search" size={15} /><input placeholder="Filter this workspace…" value={listQuery} onChange={(event) => setListQuery(event.target.value)} /></div></div>
            <TransactionTable rows={filteredTransactions} onOpen={openTransaction} />
          </>}
        </section>}

        {page === "accounts" && <>
          <section className="panel panel-pad" style={{ marginBottom: 15 }}><SectionHeading title="Cash and bank balances" subtitle="Balances are presented per currency; functional values are shown in the workspace reporting currency." action={<button type="button" className="btn btn-primary btn-sm" onClick={openAccount}><Icon name="plus" size={14} />Add cash / bank</button>} />
            {cashAccounts.length === 0 ? <EmptyState icon="bank" title="No cash or bank accounts" description="Create an account before approving a paid transaction. No payment destination is assumed." action={<button type="button" className="btn btn-outline btn-sm" onClick={openAccount}>Add account</button>} /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Account</th><th>Type</th><th>Currency</th><th>Balance</th><th>Reporting value</th></tr></thead><tbody>{cashAccounts.map((account) => <tr key={account.id}><td className="table-primary">{account.name}</td><td style={{ textTransform: "capitalize" }}>{account.type}</td><td>{account.currencyCode}</td><td><strong>{account.balance} {account.currencyCode}</strong></td><td>{account.functionalBalance} {activeBusiness.baseCurrency}</td></tr>)}</tbody></table></div>}
          </section>
          <div className="dashboard-grid">
            <section className="panel panel-pad"><SectionHeading title="Customer amounts due" subtitle="Receivables, by settlement currency" />{overview?.receivables.length ? <div className="stock-list">{overview.receivables.map((account) => <div className="stock-row" key={account.id}><span className="currency-badge">{account.currencyCode}</span><div className="stock-info"><strong>{account.name}</strong><small>Approved receivable balance</small></div><div className="stock-qty">{account.balance} {account.currencyCode}</div></div>)}</div> : <div className="field-hint">No open posted customer balances.</div>}</section>
            <section className="panel panel-pad"><SectionHeading title="Supplier amounts payable" subtitle="Payables, by settlement currency" />{overview?.payables.length ? <div className="stock-list">{overview.payables.map((account) => <div className="stock-row" key={account.id}><span className="currency-badge">{account.currencyCode}</span><div className="stock-info"><strong>{account.name}</strong><small>Approved payable balance</small></div><div className="stock-qty">{absoluteValue(account.balance)} {account.currencyCode}</div></div>)}</div> : <div className="field-hint">No open posted supplier balances.</div>}</section>
          </div>
        </>}

        {(page === "customers" || page === "suppliers") && <section className="panel panel-pad">
          <div className="toolbar"><div className="filter-row"><span className="eyebrow">{page === "customers" ? customers.length : suppliers.length} business-specific records</span></div><div className="search-box" style={{ width: 260 }}><Icon name="search" size={15} /><input value={listQuery} onChange={(event) => setListQuery(event.target.value)} placeholder={`Search ${page}…`} /></div></div>
          {(() => { const list = (page === "customers" ? customers : suppliers).filter((contact) => [contact.name, contact.email, contact.phone].some((value) => String(value ?? "").toLowerCase().includes(listQuery.toLowerCase()))); return list.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Records</th><th></th></tr></thead><tbody>{list.map((contact) => <tr key={contact.id}><td><span className="table-primary">{contact.name}</span><span className="table-secondary">Added {new Date(contact.createdAt).toLocaleDateString()}</span></td><td>{contact.phone || "—"}</td><td>{contact.email || "—"}</td><td><span className="subtle">Open statement</span></td><td><button type="button" className="btn btn-outline btn-sm" onClick={() => openContact({ id: contact.id, kind: page === "customers" ? "customer" : "supplier" })}>View statement</button></td></tr>)}</tbody></table></div> : <EmptyState icon="users" title={`No ${page} found`} description="Add a business-specific contact to track statements and payments." action={<button type="button" className="btn btn-primary btn-sm" onClick={() => setShowContactForm(page === "customers" ? "customer" : "supplier")}>Add {page === "customers" ? "customer" : "supplier"}</button>} />; })()}
        </section>}

        {page === "bookings" && <section className="panel panel-pad">
          <div className="callout info" style={{ marginBottom: 14 }}><Icon name="plane" />Ticket and Umrah statuses are operational facts entered by an authorized user. The system never claims a booking is issued, confirmed, paid, or visa-approved without explicit records.</div>
          {bookings.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Service / customer</th><th>Travel</th><th>Reference / route</th><th>Sale / paid</th><th>Operational status</th><th>Financial status</th><th></th></tr></thead><tbody>{bookings.map(({ booking, transaction, customerName }) => <tr key={booking.id}><td><span className="table-primary">{booking.serviceType === "ticket" ? "Airline ticket" : "Umrah service"}</span><span className="table-secondary">{customerName || "Customer not recorded"}{booking.passengerName ? ` · ${booking.passengerName}` : ""}</span></td><td>{booking.travelDate ? new Date(booking.travelDate).toLocaleDateString() : "—"}<span className="table-secondary">{booking.airlineName || "Service date"}</span></td><td>{booking.bookingReference || "—"}<span className="table-secondary">{[booking.origin, booking.destination].filter(Boolean).join(" → ") || booking.serviceDescription || "—"}</span></td><td><span className="table-primary">{booking.saleAmount} {booking.currencyCode}</span><span className="table-secondary">Paid {booking.paidAmount} {booking.currencyCode}</span></td><td><select aria-label="Operational booking status" value={booking.bookingStatus} onChange={async (event) => { try { await apiRequest(`bookings/${booking.id}`, { method: "PATCH", businessId: activeBusiness.id, body: { bookingStatus: event.target.value } }); showToast("Booking status saved. This is an explicit user update.", "success"); refresh(); } catch (cause) { showToast(cause instanceof Error ? cause.message : "Booking status was not changed.", "error"); } }} style={{ maxWidth: 135, padding: "6px 8px", border: "1px solid #e1e5e9", borderRadius: 7, background: "#fff", fontSize: 10 }}><option value="quotation">Quotation</option><option value="reserved">Reserved</option><option value="issued">Issued</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option></select></td><td><StatusPill status={transaction.status} /></td><td><button type="button" className="btn btn-quiet btn-sm" onClick={() => openTransaction(transaction)}>Review</button></td></tr>)}</tbody></table></div> : <EmptyState icon="plane" title="No bookings yet" description="Create a ticket or Umrah service draft. Supplier cost, amount paid, and operational status are recorded separately." action={<button className="btn btn-primary btn-sm" type="button" onClick={openBooking}><Icon name="plus" size={14} />New booking draft</button>} />}
        </section>}

        {page === "income" && <section className="panel panel-pad">
          <div className="callout info" style={{ marginBottom: 13 }}><Icon name="wallet" />Partially received income creates a currency-specific receivable; unpaid expense creates a payable. Later settlement drafts clear balances without recognizing duplicate income or expense.</div>
          <TransactionTable rows={transactions.filter((row) => ["income", "expense", "customer_payment", "supplier_payment"].includes(row.transaction.kind))} onOpen={openTransaction} />
        </section>}

        {page === "reports" && <>
          <section className="panel panel-pad" style={{ marginBottom: 15 }}>
            <div className="toolbar"><div><div className="eyebrow">Reporting period</div><div className="field-hint" style={{ marginTop: 5 }}>Business values use {activeBusiness.baseCurrency}. Cash movement stays separated by transaction currency.</div></div><div className="filter-row"><div className="field"><label>From</label><input type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} /></div><div className="field"><label>To</label><input type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)} /></div><button type="button" className="btn btn-primary btn-sm" onClick={loadReport}><Icon name="filter" size={14} />Apply dates</button></div></div>
            <div className="callout warn"><Icon name="globe" />Consolidated reports show each authorized business in its own reporting currency. No USD, GBP, EGP, or BDT totals are added together without an explicit conversion policy.</div>
          </section>
          {report && <>
            <div className="kpi-grid">
              <KpiCard label="Revenue" value={report.revenue} currency={report.reportingCurrency} icon="chart" color="#147d73" wash="#ecf6f2" />
              <KpiCard label="Operating expenses" value={report.expenses} currency={report.reportingCurrency} icon="wallet" color="#bd725b" wash="#fbefec" />
              <KpiCard label="Realized exchange result" value={decimalString(parseDecimal(report.realizedExchangeGains) - parseDecimal(report.realizedExchangeLosses))} currency={report.reportingCurrency} icon="coins" color="#9c7c37" wash="#f8f2e6" meta={`Gains ${report.realizedExchangeGains} · Losses ${report.realizedExchangeLosses}`} />
              <KpiCard label="Net profit" value={report.netProfit} currency={report.reportingCurrency} icon="trend" />
            </div>
            <div className="dashboard-grid">
              <section className="panel panel-pad"><SectionHeading title="Profit & loss" subtitle="Calculated only from posted journal entries for this period" />
                <div className="list-stack"><div className="list-row"><span className="row-main"><strong>Service and other revenue</strong><small>Cr revenue accounts, net of reversals</small></span><span className="row-value">{report.revenue} {report.reportingCurrency}</span></div><div className="list-row"><span className="row-main"><strong>Operating costs</strong><small>Supplier costs and expenses recognized</small></span><span className="row-value">−{report.expenses} {report.reportingCurrency}</span></div><div className="list-row"><span className="row-main"><strong>Realized currency exchange gains</strong></span><span className="row-value">{report.realizedExchangeGains} {report.reportingCurrency}</span></div><div className="list-row"><span className="row-main"><strong>Realized currency exchange losses</strong></span><span className="row-value">−{report.realizedExchangeLosses} {report.reportingCurrency}</span></div><div className="list-row"><span className="row-main"><strong>Net profit</strong><small>Revenue − operating expenses + gains − losses</small></span><span className="row-value amount-positive">{report.netProfit} {report.reportingCurrency}</span></div></div>
              </section>
              <section className="panel panel-pad"><SectionHeading title="Cash flow by currency" subtitle="Do not add currencies together" />
                {Object.keys(report.cashFlowByCurrency).length ? <div className="stock-list">{Object.entries(report.cashFlowByCurrency).map(([currency, amount]) => <div className="stock-row" key={currency}><span className="currency-badge">{currency}</span><div className="stock-info"><strong>Net cash movement</strong><small>Cash and bank journal activity</small></div><div className="stock-qty">{amount}<small>{currency}</small></div></div>)}</div> : <div className="field-hint">No cash movement in this period.</div>}
              </section>
            </div>
            {isOwner && <section className="panel panel-pad" style={{ marginTop: 15 }}><SectionHeading title="Owner-only consolidated view" subtitle="One report per authorized business. Cross-currency totals remain uncombined." action={<button className="btn btn-outline btn-sm" type="button" onClick={loadConsolidated}><Icon name="chart" size={14} />Load consolidated reports</button>} />
              {consolidated && <div className="dashboard-grid">{consolidated.map((item) => <div className="panel" key={item.business} style={{ padding: 15, boxShadow: "none" }}><strong style={{ fontSize: 11 }}>{item.business}</strong><div className="field-hint" style={{ marginTop: 8 }}>Net profit · {item.report.netProfit} {item.report.reportingCurrency}</div><div className="field-hint">Revenue · {item.report.revenue} {item.report.reportingCurrency}</div><div className="field-hint">Expenses · {item.report.expenses} {item.report.reportingCurrency}</div></div>)}</div>}
            </section>}
          </>}
        </>}

        {page === "receipts" && <section className="panel panel-pad"><SectionHeading title="Finalized document history" subtitle="Final receipts are generated from the approved transaction, never from an unpersisted draft." />
          {receiptRows.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Receipt</th><th>Customer / service</th><th>Date</th><th>Amount</th><th>Payment</th><th></th></tr></thead><tbody>{receiptRows.map((row) => <tr key={String(row.receipt.receiptNumber)}><td><span className="table-primary">{String(row.receipt.receiptNumber)}</span><span className="table-secondary">{transactionName(row.transaction)}</span></td><td>{row.customerName || row.transaction.description || "—"}</td><td>{new Date(row.transaction.transactionDate).toLocaleDateString()}</td><td>{row.transaction.totalAmount} {row.transaction.settlementCurrency}</td><td><StatusPill status={row.transaction.paymentAmount === row.transaction.totalAmount ? "paid" : row.transaction.paymentAmount === "0" ? "draft" : "partial"} /></td><td><button type="button" className="btn btn-outline btn-sm" onClick={() => setReceiptId(row.transaction.id)}><Icon name="receipt" size={14} />Preview / share</button></td></tr>)}</tbody></table></div> : <EmptyState icon="receipt" title="No final receipts yet" description="Approve a financial draft to persist a unique receipt number. Draft slips are intentionally not labeled as final receipts." action={<button type="button" className="btn btn-outline btn-sm" onClick={() => setPage("transactions")}>View transactions</button>} />}
        </section>}

        {page === "staff" && <section className="panel panel-pad"><SectionHeading title="Workspace team" subtitle="Membership and role are scoped to this business, not shared with other workspaces." action={isOwner ? <button className="btn btn-primary btn-sm" type="button" onClick={() => setShowStaff(true)}><Icon name="plus" size={14} />Grant access</button> : undefined} />
          {!isOwner && <div className="callout info" style={{ marginBottom: 12 }}><Icon name="shield" />Only this workspace owner can change roles or grant access.</div>}
          {staff.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Team member</th><th>Email</th><th>Role</th><th>Approval permission</th><th>Joined</th><th></th></tr></thead><tbody>{staff.map((row) => <tr key={row.membership.id}><td className="table-primary">{row.userName}</td><td>{row.email}</td><td>{isOwner && row.membership.role !== "owner" ? <select value={row.membership.role} onChange={async (event) => { try { await apiRequest(`staff/${row.membership.id}`, { method: "PATCH", businessId: activeBusiness.id, body: { role: event.target.value } }); showToast("Workspace role updated.", "success"); refresh(); } catch (cause) { showToast(cause instanceof Error ? cause.message : "Role could not be changed.", "error"); } }} style={{ border: "1px solid #e2e6e9", borderRadius: 7, padding: "6px 8px", fontSize: 10 }}><option value="manager">Manager</option><option value="staff">Staff</option><option value="viewer">Viewer</option></select> : <StatusPill status={row.membership.role} />}</td><td>{row.membership.role === "owner" ? <span className="amount-positive">Owner only</span> : "Not permitted"}</td><td>{new Date(row.membership.createdAt).toLocaleDateString()}</td><td>{isOwner && row.membership.role !== "owner" && <button type="button" className="btn btn-danger btn-sm" onClick={async () => { if (!confirm(`Remove ${row.email} from this workspace?`)) return; try { await apiRequest(`staff/${row.membership.id}`, { method: "DELETE", businessId: activeBusiness.id }); showToast("Workspace access removed.", "success"); refresh(); } catch (cause) { showToast(cause instanceof Error ? cause.message : "Access could not be removed.", "error"); } }}>Remove</button>}</td></tr>)}</tbody></table></div> : <EmptyState icon="users" title="No team access configured" description="Only the owner can approve financial postings. Grant workspace-specific access to registered accounts." />}
        </section>}

        {page === "audit" && <section className="panel panel-pad"><SectionHeading title="Immutable activity history" subtitle="Latest owner, financial, permission, and workspace events." />
          {auditEvents.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Record</th><th>Details</th></tr></thead><tbody>{auditEvents.map((event) => <tr key={event.id}><td>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.createdAt))}</td><td>{event.actorName || "System"}<span className="table-secondary">{event.actorEmail || ""}</span></td><td><span className="table-primary">{event.action.replaceAll(".", " · ")}</span></td><td>{event.entityType}{event.entityId ? <span className="table-secondary">{event.entityId.slice(0, 12)}</span> : ""}</td><td>{Object.entries(event.details ?? {}).slice(0, 3).map(([key, value]) => `${key}: ${String(value)}`).join(" · ") || "—"}</td></tr>)}</tbody></table></div> : <EmptyState icon="clipboard" title="No audit events yet" description="Workspace activity is recorded as the owner creates drafts, approves, updates settings, and manages access." />}
        </section>}

        {page === "notifications" && <>
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}><KpiCard label="Items awaiting owner review" value={String(notifications.pendingApprovals || pendingCount)} icon="shield" meta="Drafts do not post automatically" color="#bd7c36" wash="#fbf3e8" /><KpiCard label="Recent workspace events" value={String(notifications.recentEvents.length)} icon="bell" meta="Most recent audit activity" color="#56729a" wash="#edf2f8" /><KpiCard label="Business scope" value="Private" icon="lock" meta="Selected authorized workspace only" color="#147c74" wash="#edf6f2" /></div>
          <section className="panel panel-pad"><SectionHeading title="Recent notifications" subtitle="Actionable events from this business only" />{notifications.recentEvents.length ? <div className="list-stack">{notifications.recentEvents.map((event) => <div className="list-row" key={event.id}><span className="row-icon"><Icon name={event.action.includes("approve") ? "circleCheck" : "bell"} size={16} /></span><div className="row-main"><strong>{event.action.replaceAll(".", " · ")}</strong><small>{event.actorName || "System"} · {new Date(event.createdAt).toLocaleString()}</small></div><span className="row-value">{event.entityType}</span></div>)}</div> : <EmptyState icon="bell" title="You’re all caught up" description="New drafts and approved changes will appear here." />}</section>
        </>}

        {page === "settings" && <div className="dashboard-grid">
          <section className="panel panel-pad"><SectionHeading title="Company identity and branding" subtitle="Edit contact details and visual identity. No addresses or legal claims are prefilled." />
            {settingsError && <div className="alert">{settingsError}</div>}{settingsSaved && <div className="success-note">Settings saved. The active workspace brand has been updated.</div>}
            {settingsDraft && <form onSubmit={saveSettings}>
              <div className="form-grid">
                <div className="field full"><label>Business name</label><input value={settingsDraft.name} onChange={(event) => setSettingsDraft({ ...settingsDraft, name: event.target.value })} required /></div>
                <div className="field"><label>Reporting currency</label><select value={settingsDraft.baseCurrency} onChange={(event) => setSettingsDraft({ ...settingsDraft, baseCurrency: event.target.value })}>{currencies.filter((currency) => currency.active).map((currency) => <option key={currency.code} value={currency.code}>{currency.code} · {currency.name}</option>)}</select><span className="field-hint">Locked after postings exist to preserve historical reporting basis.</span></div>
                <div className="field"><label>Business time zone</label><input value={settingsDraft.timezone} onChange={(event) => setSettingsDraft({ ...settingsDraft, timezone: event.target.value })} placeholder="Africa/Cairo" required /></div>
                <div className="field"><label>Phone</label><input value={settingsDraft.phone} onChange={(event) => setSettingsDraft({ ...settingsDraft, phone: event.target.value })} placeholder="Add only a verified business number" /></div>
                <div className="field"><label>Email</label><input type="email" value={settingsDraft.email} onChange={(event) => setSettingsDraft({ ...settingsDraft, email: event.target.value })} placeholder="Add a business email" /></div>
                <div className="field full"><label>Address</label><input value={settingsDraft.address} onChange={(event) => setSettingsDraft({ ...settingsDraft, address: event.target.value })} placeholder="Leave blank until the owner confirms details" /></div>
                <div className="field full"><label>Logo URL or public local asset</label><input value={settingsDraft.logoUrl} onChange={(event) => setSettingsDraft({ ...settingsDraft, logoUrl: event.target.value })} placeholder="/branding/osama-trusted-solutions.svg" /><span className="field-hint">Use a local asset or HTTPS URL. Upload hosting is not configured.</span></div>
                <div className="field"><label>Primary brand color</label><div style={{ display: "flex", gap: 9, alignItems: "center" }}><input type="color" value={settingsDraft.primaryColor} onChange={(event) => setSettingsDraft({ ...settingsDraft, primaryColor: event.target.value })} style={{ width: 48, height: 39, padding: 3 }} /><input value={settingsDraft.primaryColor} onChange={(event) => setSettingsDraft({ ...settingsDraft, primaryColor: event.target.value })} /></div></div>
                <div className="field"><label>Accent / gold color</label><div style={{ display: "flex", gap: 9, alignItems: "center" }}><input type="color" value={settingsDraft.accentColor} onChange={(event) => setSettingsDraft({ ...settingsDraft, accentColor: event.target.value })} style={{ width: 48, height: 39, padding: 3 }} /><input value={settingsDraft.accentColor} onChange={(event) => setSettingsDraft({ ...settingsDraft, accentColor: event.target.value })} /></div></div>
                <div className="field full"><label>Customer receipt terms (optional)</label><textarea rows={3} value={settingsDraft.terms} onChange={(event) => setSettingsDraft({ ...settingsDraft, terms: event.target.value })} placeholder="Only include terms the owner has configured." /></div>
              </div>
              <div style={{ display: "flex", gap: 11, alignItems: "center", marginTop: 16 }}><button className="btn btn-primary" type="submit" disabled={settingsSaving || !isOwner}>{settingsSaving ? "Saving…" : "Save business settings"}</button>{settingsDraft.logoUrl && <img src={settingsDraft.logoUrl} alt="Selected business logo preview" style={{ maxHeight: 38, maxWidth: 180, objectFit: "contain" }} />}</div>
              {!isOwner && <div className="field-hint" style={{ marginTop: 8 }}>Only the workspace owner can change identity and brand settings.</div>}
            </form>}
          </section>
          <div style={{ display: "grid", gap: 15, alignContent: "start" }}>
            <section className="panel panel-pad"><SectionHeading title="Currencies & rate history" subtitle="No live exchange rate is connected or invented." action={isOwner ? <button className="btn btn-outline btn-sm" type="button" onClick={() => setShowCurrency(true)}><Icon name="plus" size={14} />Add currency</button> : undefined} />
              <div className="stock-list">{currencies.filter((currency) => currency.active).map((currency) => <div className="stock-row" key={currency.code}><div className="currency-badge">{currency.code}</div><div className="stock-info"><strong>{currency.name}</strong><small>{currency.decimalPlaces} decimal places · {currency.code === activeBusiness.baseCurrency ? "Reporting currency" : "Owner-entered rates only"}</small></div><span className="status-pill posted">Active</span></div>)}</div>
              <div className="callout info" style={{ marginTop: 13 }}><Icon name="clock" />{rates.length} owner-entered rate records. Each stores its source label and capture timestamp.</div>
            </section>
            <section className="panel panel-pad"><SectionHeading title="AI provider setup" subtitle="Optional provider calls are server-side only." />
              <div className={`callout ${assistantConfig?.configured ? "good" : "warn"}`}><Icon name={assistantConfig?.configured ? "circleCheck" : "warning"} />{assistantConfig?.configured ? `Provider configured: ${assistantConfig.provider} · ${assistantConfig.model ?? "server default model"}.` : "External AI is not connected. The app uses limited local command rules and labels that clearly."}</div>
              {!assistantConfig?.configured && <div className="field-hint" style={{ marginTop: 10 }}>Set OPENAI_API_KEY and optionally OPENAI_MODEL in the server environment, then restart the app. The key is never sent to the browser.</div>}
              <div className="field-hint" style={{ marginTop: 10 }}>Browser speech recognition is used only if supported and allowed by the device. Speech text is sent only when you press Send.</div>
            </section>
            <section className="panel panel-pad"><SectionHeading title="Security and access" subtitle={ownerBadge} /><div className="list-stack"><div className="list-row"><span className="row-icon"><Icon name="lock" size={15} /></span><div className="row-main"><strong>HTTP-only session cookie</strong><small>Same-origin mutation checks and server authorization</small></div></div><div className="list-row"><span className="row-icon"><Icon name="shield" size={15} /></span><div className="row-main"><strong>Owner-only approval</strong><small>Financial changes post inside database transactions</small></div></div></div></section>
            <section className="panel panel-pad"><SectionHeading title="Add a separate workspace" subtitle="Keep a new business independent from the selected books." /><button type="button" className="btn btn-outline btn-wide" onClick={() => setShowBusiness(true)}><Icon name="building" size={15} />Create another business</button></section>
          </div>
        </div>}

        {page === "language" && <div className="dashboard-grid">
          <section className="panel panel-pad"><SectionHeading title="Application language" subtitle="Arabic enables right-to-left layout; data values remain unchanged." />
            <div className="form-grid"><div className="field full"><label>Preferred language</label><select value={language} onChange={(event) => setLanguage(event.target.value as "en" | "bn" | "ar")}><option value="en">English</option><option value="bn">বাংলা · Bengali</option><option value="ar">العربية · Arabic</option></select><span className="field-hint">Your selection is stored on this device.</span></div></div>
            <div className="callout info" style={{ marginTop: 14 }}><Icon name="globe" />{language === "ar" ? "تم تفعيل اتجاه الكتابة من اليمين إلى اليسار." : language === "bn" ? "বাংলা নম্বর ইনপুট সহকারী বুঝতে পারে।" : "The assistant accepts English, Bengali, and Arabic text. Browser voice support depends on your device."}</div>
          </section>
          <section className="panel panel-pad"><SectionHeading title="AI and voice configuration" subtitle="External services are optional and never receive secrets from the browser." />
            <div className={`callout ${assistantConfig?.configured ? "good" : "warn"}`}><Icon name={assistantConfig?.configured ? "circleCheck" : "warning"} />{assistantConfig?.configured ? `AI provider is configured on the server (${assistantConfig.provider}).` : "AI provider key is missing. Limited local rules remain available; the app does not claim that a model is connected."}</div>
            <div className="list-stack" style={{ marginTop: 13 }}><div className="list-row"><span className="row-icon"><Icon name="mic" size={15} /></span><div className="row-main"><strong>Speech input</strong><small>Browser speech recognition where the device supports it</small></div></div><div className="list-row"><span className="row-icon"><Icon name="message" size={15} /></span><div className="row-main"><strong>Spoken response</strong><small>Optional on-device text-to-speech</small></div></div></div>
            <button type="button" className="btn btn-outline" style={{ marginTop: 11 }} onClick={() => setPage("settings")}>Open provider setup instructions</button>
          </section>
        </div>}
      </main>
    </div>

    <nav className="mobile-bottom-nav" aria-label="Quick navigation">
      {(["overview", "exchange", "assistant", "approvals", "accounts"] as Page[]).map((navPage) => {
        if (navPage === "exchange" && activeBusiness.category === "travel_agency") return <button key={navPage} className={`mobile-nav-item ${page === "bookings" ? "active" : ""}`} type="button" onClick={openBooking}><Icon name="plane" /><span>Booking</span></button>;
        return <button key={navPage} className={`mobile-nav-item ${page === navPage ? "active" : ""}`} type="button" onClick={() => setPage(navPage)}><Icon name={iconForPage[navPage]} /><span>{navPage === "overview" ? "Home" : navPage === "assistant" ? "Ask AI" : navPage === "approvals" ? "Approvals" : navPage === "accounts" ? "Accounts" : "Exchange"}</span></button>;
      })}
    </nav>

    {showExchange && <ExchangeFormModal business={activeBusiness} currencies={currencies} accounts={accounts} customers={customers} suppliers={suppliers} onClose={() => setShowExchange(false)} onCreated={handleCreated} />}
    {showBooking && <BookingFormModal business={activeBusiness} currencies={currencies} accounts={accounts} customers={customers} suppliers={suppliers} onClose={() => setShowBooking(false)} onCreated={handleCreated} />}
    {showIncome && <IncomeExpenseModal business={activeBusiness} currencies={currencies} accounts={accounts} customers={customers} suppliers={suppliers} onClose={() => setShowIncome(false)} onCreated={handleCreated} />}
    {showAccount && <AccountFormModal business={activeBusiness} currencies={currencies} onClose={() => setShowAccount(false)} onCreated={() => { setShowAccount(false); refresh(); showToast("Account created. It is available for future drafts.", "success"); }} />}
    {showBusiness && <BusinessFormModal onClose={() => setShowBusiness(false)} onCreated={(business) => { setBusinesses((current) => [...current, { ...business, role: "owner" }]); setSelectedBusinessId(business.id); window.localStorage.setItem("business-ledger.active-workspace", business.id); setShowBusiness(false); setPage("overview"); refresh(); showToast("Separate business workspace created.", "success"); }} />}
    {showCurrency && <CurrencyFormModal business={activeBusiness} onClose={() => setShowCurrency(false)} onCreated={() => { setShowCurrency(false); refresh(); void loadFormDependencies(); showToast("Currency enabled with separate system ledger accounts.", "success"); }} />}
    {showContactForm && <ContactFormModal business={activeBusiness} kind={showContactForm} onClose={() => setShowContactForm(null)} onCreated={() => { const kind = showContactForm; setShowContactForm(null); refresh(); showToast(`${kind === "customer" ? "Customer" : "Supplier"} saved in this workspace.`, "success"); }} />}
    {showStaff && <StaffFormModal business={activeBusiness} onClose={() => setShowStaff(false)} onCreated={() => { setShowStaff(false); refresh(); showToast("Workspace access granted. No invitation email was sent.", "success"); }} />}
    {reviewId && <ReviewModal transactionId={reviewId} business={activeBusiness} accounts={accounts} customers={customers} suppliers={suppliers} isOwner={Boolean(isOwner)} onClose={() => setReviewId("")} onChanged={updateTransaction} onReceipt={(id) => { setReviewId(""); setReceiptId(id); }} />}
    {receiptId && <ReceiptModal transactionId={receiptId} business={activeBusiness} onClose={() => setReceiptId("")} />}
    {contactTarget && <ContactStatementModal business={activeBusiness} kind={contactTarget.kind} contactId={contactTarget.id} onClose={() => setContactTarget(null)} onPayment={(contact, kind, balances) => { setContactTarget(null); setPaymentTarget({ contact, kind, balances }); }} />}
    {paymentTarget && <PaymentFormModal business={activeBusiness} contact={paymentTarget.contact} kind={paymentTarget.kind} balances={paymentTarget.balances} currencies={currencies} accounts={accounts} onClose={() => setPaymentTarget(null)} onCreated={handleCreated} />}
    {toast && <div className="toast-stack"><div className={`toast ${toast.kind}`}>{toast.message}</div></div>}
  </div>;
}

function AssistantView({ business, language, config, messages, setMessages, input, setInput, busy, setBusy, onToast, onOpenDraft, listening, setListening, speakEnabled, setSpeakEnabled }: {
  business: Business; language: "en" | "bn" | "ar"; config: AssistantConfig | null; messages: AssistantMessage[];
  setMessages: (updater: (messages: AssistantMessage[]) => AssistantMessage[]) => void; input: string; setInput: (value: string) => void;
  busy: boolean; setBusy: (value: boolean) => void; onToast: (message: string, kind?: Toast["kind"]) => void; onOpenDraft: (id: string) => void;
  listening: boolean; setListening: (value: boolean) => void; speakEnabled: boolean; setSpeakEnabled: (value: boolean) => void;
}) {
  const [error, setError] = useState("");
  const inputLanguage = language === "bn" ? "bn-BD" : language === "ar" ? "ar-SA" : "en-US";
  async function sendMessage(value = input) {
    const text = value.trim(); if (!text || busy) return;
    setInput(""); setError(""); setBusy(true);
    const userMessage: AssistantMessage = { id: crypto.randomUUID(), role: "user", text, time: new Date().toISOString() };
    setMessages((current) => [...current, userMessage]);
    try {
      const result = await apiRequest<{ text: string; provider: string; providerWarning?: string; draft?: { transactionId?: string } | null }>("assistant", { method: "POST", businessId: business.id, body: { message: text } });
      const responseText = result.providerWarning ? `${result.text}\n\n${result.providerWarning}` : result.text;
      const message: AssistantMessage = { id: crypto.randomUUID(), role: "assistant", text: responseText, time: new Date().toISOString(), draftId: result.draft?.transactionId };
      setMessages((current) => [...current, message]);
      if (speakEnabled && "speechSynthesis" in window) {
        const speech = new SpeechSynthesisUtterance(responseText);
        speech.lang = inputLanguage; window.speechSynthesis.speak(speech);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Assistant request failed."); }
    finally { setBusy(false); }
  }
  function startVoice() {
    type Recognition = { lang: string; interimResults: boolean; continuous: boolean; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
    type RecognitionConstructor = new () => Recognition;
    const apiWindow = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const Constructor = apiWindow.SpeechRecognition ?? apiWindow.webkitSpeechRecognition;
    if (!Constructor) { onToast("Speech recognition is not supported by this browser. You can still type your request.", "info"); return; }
    const recognition = new Constructor(); recognition.lang = inputLanguage; recognition.interimResults = false; recognition.continuous = false;
    recognition.onresult = (event) => { const transcript = event.results[0]?.[0]?.transcript ?? ""; setInput(transcript); };
    recognition.onerror = () => { setListening(false); onToast("Microphone input could not be recognized. Please type or try again.", "error"); };
    recognition.onend = () => setListening(false);
    try { setListening(true); recognition.start(); } catch { setListening(false); onToast("Microphone input could not be started.", "error"); }
  }
  const prompts = [
    "How much USD inventory is left?",
    "Show today's profit for this business.",
    "I bought 10,000 USD at 128.24 EGP per USD.",
    "Show outstanding customer and supplier balances.",
    "Create a receipt for an existing posted transaction.",
  ];
  return <div className="assistant-layout">
    <section className="panel chat-panel">
      <div className="chat-head"><div className="chat-head-left"><span className="ai-avatar"><Icon name="sparkles" size={19} /></span><div><strong>Business copilot</strong><small><span className="live-dot" />{config?.configured ? `Connected · ${config.provider}` : "Limited local commands · AI provider not connected"}</small></div></div><button type="button" className={`btn ${speakEnabled ? "btn-primary" : "btn-outline"} btn-sm`} onClick={() => { if (!window.speechSynthesis) { onToast("Text-to-speech is not supported by this browser.", "info"); return; } setSpeakEnabled(!speakEnabled); }}>{speakEnabled ? "Voice on" : "Read aloud"}</button></div>
      <div className="chat-messages">
        {messages.map((message) => <div className={`chat-message ${message.role}`} key={message.id}><span className="ai-avatar" style={message.role === "user" ? { width: 29, height: 29, background: "#edf0f3", color: "#738093" } : { width: 29, height: 29 }}><Icon name={message.role === "user" ? "user" : "sparkles"} size={14} /></span><div className="chat-bubble">{message.text}{message.draftId && <div className="draft-preview"><strong>Draft created · not posted</strong><small>The server validated the draft. Review account, counterparty, and calculated impact before owner approval.</small><button className="btn btn-outline btn-sm" style={{ marginTop: 9 }} type="button" onClick={() => onOpenDraft(message.draftId!)}>Review draft <Icon name="arrow" size={12} /></button></div>}<small>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(message.time))}</small></div></div>)}
        {busy && <div className="chat-message"><span className="ai-avatar" style={{ width: 29, height: 29 }}><Icon name="sparkles" size={14} /></span><div className="chat-bubble"><span className="spinner" style={{ width: 13, height: 13 }} /></div></div>}
      </div>
      {error && <div className="alert" style={{ margin: "0 14px" }}>{error}</div>}
      <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
        <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={language === "bn" ? "বাংলা, ইংরেজি বা আরবিতে লিখুন…" : language === "ar" ? "اكتب سؤالك أو أمرك…" : "Ask about approved records or describe a draft…"} aria-label="Assistant message" />
        <button type="button" className={`icon-button ${listening ? "btn-primary" : ""}`} onClick={startVoice} aria-label="Use speech input" title="Use your device's supported speech recognition"><Icon name="mic" size={17} /></button>
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()} aria-label="Send message"><Icon name="send" size={15} /></button>
      </form>
    </section>
    <aside className="assistant-side">
      <section className="panel chat-side-card"><h3>Try a request</h3>{prompts.map((prompt) => <button className="prompt-chip" key={prompt} type="button" onClick={() => setInput(prompt)}>{prompt}</button>)}</section>
      <section className="panel chat-side-card"><h3>Selected workspace</h3><div className="row-main"><strong>{business.name}</strong><small>{business.baseCurrency} reporting · {business.timezone}</small></div><div className="ai-config-note">{config?.configured ? `Server-side ${config.provider} is connected. The provider may create validated drafts only.` : "AI provider key missing. Local language rules are limited; this is not a connected model."}</div><div className="field-hint" style={{ marginTop: 10 }}>No live FX rates are invented. Every financial posting still needs owner approval.</div></section>
    </aside>
  </div>;
}
