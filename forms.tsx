"use client";

import { useMemo, useState, type FormEvent } from "react";
import { apiRequest } from "@/lib/client-api";
import { add, decimalString, multiply, parseDecimal, roundTo } from "@/lib/decimal";
import { Icon, Modal } from "@/components/common";
import type { Account, Business, Contact, ContactBalance, Currency, Transaction } from "@/components/app-types";

type Created = (transaction: Transaction) => void;

function calcProduct(left: string, right: string, places = 2): string {
  try {
    if (!left || !right) return "0";
    return decimalString(roundTo(multiply(parseDecimal(left), parseDecimal(right)), places));
  } catch { return "0"; }
}
function calcTotal(left: string, right: string, places = 2): string {
  try { return decimalString(roundTo(add(parseDecimal(left || "0"), parseDecimal(right || "0")), places)); }
  catch { return "0"; }
}
function moneyText(value: string, currency: string) { return `${value} ${currency}`; }

function TextField({ label, value, onChange, placeholder, type = "text", required = false, hint, min, step, full = false, inputMode }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; required?: boolean;
  hint?: string; min?: string; step?: string; full?: boolean; inputMode?: "text" | "decimal" | "numeric";
}) {
  return <div className={`field ${full ? "full" : ""}`}><label>{label}{required && <em> · required</em>}</label><input type={type} required={required} min={min} step={step} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />{hint && <span className="field-hint">{hint}</span>}</div>;
}

function SelectField({ label, value, onChange, options, placeholder = "Select…", required = false, hint, full = false }: {
  label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>;
  placeholder?: string; required?: boolean; hint?: string; full?: boolean;
}) {
  return <div className={`field ${full ? "full" : ""}`}><label>{label}{required && <em> · required</em>}</label><select required={required} value={value} onChange={(event) => onChange(event.target.value)}><option value="">{placeholder}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{hint && <span className="field-hint">{hint}</span>}</div>;
}

function TextAreaField({ label, value, onChange, placeholder, rows = 3, full = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; rows?: number; full?: boolean }) {
  return <div className={`field ${full ? "full" : ""}`}><label>{label}</label><textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></div>;
}

export function ExchangeFormModal({ business, currencies, accounts, customers, suppliers, onClose, onCreated }: {
  business: Business; currencies: Currency[]; accounts: Account[]; customers: Contact[]; suppliers: Contact[]; onClose: () => void; onCreated: Created;
}) {
  const [kind, setKind] = useState<"fx_purchase" | "fx_sale">("fx_purchase");
  const [quantity, setQuantity] = useState("");
  const [tradedCurrency, setTradedCurrency] = useState("USD");
  const [settlementCurrency, setSettlementCurrency] = useState(business.baseCurrency);
  const [rate, setRate] = useState("");
  const [baseRate, setBaseRate] = useState("");
  const [fee, setFee] = useState("0");
  const [paymentAmount, setPaymentAmount] = useState("0");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const places = currencies.find((currency) => currency.code === settlementCurrency)?.decimalPlaces ?? 2;
  const gross = useMemo(() => calcProduct(quantity, rate, places), [quantity, rate, places]);
  const total = useMemo(() => calcTotal(gross, fee, places), [gross, fee, places]);
  const selectedTradedCurrency = currencies.find((currency) => currency.code === tradedCurrency);
  const eligibleAccounts = accounts.filter((account) => account.active && ["cash", "bank"].includes(account.type) && account.currencyCode === settlementCurrency);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const result = await apiRequest<{ transaction: Transaction }>("transactions", {
        method: "POST", businessId: business.id,
        body: {
          kind, quantity, tradedCurrency, settlementCurrency, rate, baseRate: baseRate || undefined, fee,
          paymentAmount: paymentAmount || "0", paymentAccountId: paymentAccountId || null,
          customerId: kind === "fx_sale" ? customerId || null : null,
          supplierId: kind === "fx_purchase" ? supplierId || null : null,
          location: location || null, notes: notes || null, idempotencyKey: `form-${crypto.randomUUID()}`,
        },
      });
      onCreated(result.transaction);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Draft could not be created.");
    } finally { setBusy(false); }
  }

  return <Modal title="Create currency transaction" subtitle={`${business.name} · Draft only until owner approval`} onClose={onClose} wide footer={<><button className="btn btn-outline" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" form="exchange-draft" disabled={busy}><Icon name="plus" size={15} />{busy ? "Saving draft…" : "Create transaction draft"}</button></>}>
    {error && <div className="alert" role="alert">{error}</div>}
    <div className="segment-control" style={{ marginBottom: 16 }}><button className={kind === "fx_purchase" ? "active" : ""} onClick={() => setKind("fx_purchase")} type="button">Purchase currency</button><button className={kind === "fx_sale" ? "active" : ""} onClick={() => setKind("fx_sale")} type="button">Sell currency</button></div>
    <form id="exchange-draft" onSubmit={submit}>
      <div className="form-grid three">
        <TextField label="Quantity" type="text" inputMode="decimal" value={quantity} onChange={setQuantity} placeholder="10,000" required hint="Up to 8 decimal places." />
        <SelectField label="Currency acquired / sold" value={tradedCurrency} onChange={setTradedCurrency} options={currencies.filter((currency) => currency.active).map((currency) => ({ value: currency.code, label: `${currency.code} · ${currency.name}` }))} required />
        <SelectField label="Settlement currency" value={settlementCurrency} onChange={(value) => { setSettlementCurrency(value); setPaymentAccountId(""); }} options={currencies.filter((currency) => currency.active).map((currency) => ({ value: currency.code, label: currency.code }))} required hint="The currency used for the quoted rate and settlement." />
        <TextField label={`Rate (${settlementCurrency} per ${tradedCurrency})`} value={rate} onChange={setRate} placeholder="128.24" required inputMode="decimal" hint="Owner-entered rate. No live rate is assumed." />
        {settlementCurrency !== business.baseCurrency && <TextField label={`Reporting rate (${business.baseCurrency} per ${settlementCurrency})`} value={baseRate} onChange={setBaseRate} placeholder="Enter explicit rate" required inputMode="decimal" hint="Required to report this amount in the workspace base currency." />}
        <TextField label={kind === "fx_purchase" ? "Purchase fees" : "Customer fee / commission"} value={fee} onChange={setFee} placeholder="0.00" inputMode="decimal" hint={kind === "fx_purchase" ? "Capitalized into the currency inventory cost." : "Added to customer proceeds and exchange gain."} />
        <SelectField label="Settlement account" value={paymentAccountId} onChange={setPaymentAccountId} options={eligibleAccounts.map((account) => ({ value: account.id, label: `${account.name} · ${account.currencyCode}` }))} placeholder="Not selected yet" hint="Never assume a cash or bank account." />
        <TextField label={kind === "fx_purchase" ? "Amount paid now" : "Amount received now"} value={paymentAmount} onChange={setPaymentAmount} placeholder="0.00" inputMode="decimal" hint={`Total is ${moneyText(total, settlementCurrency)}. Enter only the amount actually paid.`} />
        <TextField label="Location" value={location} onChange={setLocation} placeholder="Alexandria" />
        {kind === "fx_sale" && <SelectField label="Customer (if any balance remains)" value={customerId} onChange={setCustomerId} options={customers.map((contact) => ({ value: contact.id, label: contact.name }))} placeholder="Choose customer" />}
        {kind === "fx_purchase" && <SelectField label="Supplier (if any balance remains)" value={supplierId} onChange={setSupplierId} options={suppliers.map((contact) => ({ value: contact.id, label: contact.name }))} placeholder="Choose supplier" />}
        <TextAreaField label="Internal note" value={notes} onChange={setNotes} placeholder="Optional details for the owner review" full />
      </div>
      <div className="calculation-box">
        <div className="calc-item"><span>Exchange value</span><strong>{moneyText(gross, settlementCurrency)}</strong></div>
        <div className="calc-item"><span>Fee</span><strong>{moneyText(fee || "0", settlementCurrency)}</strong></div>
        <div className="calc-item"><span>{kind === "fx_purchase" ? "Purchase total" : "Sale proceeds"}</span><strong>{moneyText(total, settlementCurrency)}</strong></div>
      </div>
      <div className="callout warn" style={{ marginTop: 12 }}><Icon name="shield" />Creating a draft does not change cash, balances, or inventory. A sale can only be posted against available approved stock. Any unpaid remainder requires the correct customer or supplier before approval.</div>
      {selectedTradedCurrency && <span className="field-hint" style={{ display: "block", marginTop: 8 }}>Trading {selectedTradedCurrency.name} ({selectedTradedCurrency.code}).</span>}
    </form>
  </Modal>;
}

export function BookingFormModal({ business, currencies, accounts, customers, suppliers, onClose, onCreated }: {
  business: Business; currencies: Currency[]; accounts: Account[]; customers: Contact[]; suppliers: Contact[]; onClose: () => void; onCreated: Created;
}) {
  const [kind, setKind] = useState<"ticket" | "umrah">("ticket");
  const [currency, setCurrency] = useState(business.baseCurrency);
  const [customerId, setCustomerId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [passengerName, setPassengerName] = useState("");
  const [reference, setReference] = useState("");
  const [airline, setAirline] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [travelDate, setTravelDate] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("quotation");
  const [sale, setSale] = useState("");
  const [agencyFee, setAgencyFee] = useState("0");
  const [cost, setCost] = useState("0");
  const [paid, setPaid] = useState("0");
  const [supplierPaid, setSupplierPaid] = useState("0");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [supplierAccountId, setSupplierAccountId] = useState("");
  const [baseRate, setBaseRate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const places = currencies.find((item) => item.code === currency)?.decimalPlaces ?? 2;
  const total = useMemo(() => calcTotal(sale, agencyFee, places), [sale, agencyFee, places]);
  const cashAccounts = accounts.filter((account) => account.active && ["cash", "bank"].includes(account.type) && account.currencyCode === currency);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await apiRequest<{ transaction: Transaction }>("bookings", {
        method: "POST", businessId: business.id,
        body: {
          kind, settlementCurrency: currency, grossAmount: sale, fee: agencyFee, costAmount: cost,
          paymentAmount: paid || "0", paymentAccountId: paymentAccountId || null,
          supplierPaidAmount: supplierPaid || "0", supplierPaymentAccountId: supplierAccountId || null,
          customerId: customerId || null, supplierId: supplierId || null, baseRate: baseRate || undefined,
          description: description || (kind === "ticket" ? "Airline ticket" : "Umrah service"), notes: notes || null,
          idempotencyKey: `booking-${crypto.randomUUID()}`,
          booking: {
            serviceType: kind, bookingReference: reference || null, bookingStatus: status,
            passengerName: passengerName || null, airlineName: airline || null, origin: origin || null,
            destination: destination || null, travelDate: travelDate ? new Date(`${travelDate}T12:00:00.000Z`).toISOString() : null,
            serviceDescription: description || null,
          },
        },
      });
      onCreated(result.transaction);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Booking draft could not be created."); }
    finally { setBusy(false); }
  }

  return <Modal title="Create travel service draft" subtitle={`${business.name} · Booking and finances remain unconfirmed until reviewed`} onClose={onClose} wide footer={<><button className="btn btn-outline" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" form="booking-draft" disabled={busy}><Icon name="plus" size={15} />{busy ? "Saving draft…" : "Create booking draft"}</button></>}>
    {error && <div className="alert" role="alert">{error}</div>}
    <div className="segment-control" style={{ marginBottom: 16 }}><button type="button" className={kind === "ticket" ? "active" : ""} onClick={() => setKind("ticket")}>Airline ticket</button><button type="button" className={kind === "umrah" ? "active" : ""} onClick={() => setKind("umrah")}>Umrah service</button></div>
    <form id="booking-draft" onSubmit={submit}>
      <div className="form-section"><div className="form-section-title"><strong>Booking details</strong><small>Only information needed for the service</small></div><div className="form-grid three">
        <SelectField label="Operational status" value={status} onChange={setStatus} options={[{ value: "quotation", label: "Quotation" }, { value: "reserved", label: "Reserved" }, { value: "issued", label: "Issued (owner confirmed)" }, { value: "cancelled", label: "Cancelled" }]} required hint="This is not set to issued automatically." />
        <TextField label="Booking reference" value={reference} onChange={setReference} placeholder="Optional reference" />
        <TextField label="Passenger name" value={passengerName} onChange={setPassengerName} placeholder="Only if needed" hint="Sensitive information is omitted from receipts." />
        {kind === "ticket" && <><TextField label="Airline / supplier service" value={airline} onChange={setAirline} placeholder="Airline name" /><TextField label="Origin" value={origin} onChange={setOrigin} placeholder="Departure city" /><TextField label="Destination" value={destination} onChange={setDestination} placeholder="Arrival city" /></>}
        <TextField label="Travel date" type="date" value={travelDate} onChange={setTravelDate} />
        <SelectField label="Customer" value={customerId} onChange={setCustomerId} options={customers.map((item) => ({ value: item.id, label: item.name }))} placeholder="Identify customer" />
        <SelectField label="Supplier" value={supplierId} onChange={setSupplierId} options={suppliers.map((item) => ({ value: item.id, label: item.name }))} placeholder="Identify supplier" />
        <TextField label={kind === "ticket" ? "Service description" : "Umrah package / service"} value={description} onChange={setDescription} placeholder={kind === "ticket" ? "Ticket service" : "Describe only confirmed services"} />
      </div></div>
      <div className="form-section"><div className="form-section-title"><strong>Amounts and payments</strong><small>Supplier cost is internal and never printed on the customer receipt</small></div><div className="form-grid three">
        <SelectField label="Currency" value={currency} onChange={(value) => { setCurrency(value); setPaymentAccountId(""); setSupplierAccountId(""); }} options={currencies.filter((item) => item.active).map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` }))} required />
        <TextField label="Customer selling price" value={sale} onChange={setSale} placeholder="120.00" inputMode="decimal" required />
        <TextField label="Agency charge / commission" value={agencyFee} onChange={setAgencyFee} placeholder="0.00" inputMode="decimal" />
        <TextField label="Supplier cost (internal)" value={cost} onChange={setCost} placeholder="100.00" inputMode="decimal" />
        <TextField label="Amount received" value={paid} onChange={setPaid} placeholder="0.00" inputMode="decimal" hint={`Selling total: ${moneyText(total, currency)}`} />
        <SelectField label="Received into" value={paymentAccountId} onChange={setPaymentAccountId} options={cashAccounts.map((item) => ({ value: item.id, label: item.name }))} placeholder="No account selected" />
        <TextField label="Supplier amount paid" value={supplierPaid} onChange={setSupplierPaid} placeholder="0.00" inputMode="decimal" />
        <SelectField label="Supplier payment account" value={supplierAccountId} onChange={setSupplierAccountId} options={cashAccounts.map((item) => ({ value: item.id, label: item.name }))} placeholder="No account selected" />
        {currency !== business.baseCurrency && <TextField label={`Reporting rate (${business.baseCurrency} per ${currency})`} value={baseRate} onChange={setBaseRate} placeholder="Owner-entered conversion" inputMode="decimal" required hint="No live rate is assumed." />}
        <TextAreaField label="Internal booking note" value={notes} onChange={setNotes} placeholder="Optional internal note" full />
      </div></div>
      <div className="callout info"><Icon name="shield" />A financial draft is not a booking confirmation. Do not use “Issued” or “Paid” unless that status is supported by the service provider and payment records.</div>
    </form>
  </Modal>;
}

export function IncomeExpenseModal({ business, currencies, accounts, customers, suppliers, onClose, onCreated }: {
  business: Business; currencies: Currency[]; accounts: Account[]; customers: Contact[]; suppliers: Contact[]; onClose: () => void; onCreated: Created;
}) {
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [currency, setCurrency] = useState(business.baseCurrency);
  const [amount, setAmount] = useState("");
  const [paid, setPaid] = useState("0");
  const [accountId, setAccountId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [description, setDescription] = useState("");
  const [baseRate, setBaseRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cashAccounts = accounts.filter((account) => account.active && ["cash", "bank"].includes(account.type) && account.currencyCode === currency);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await apiRequest<{ transaction: Transaction }>("transactions", {
        method: "POST", businessId: business.id,
        body: {
          kind, settlementCurrency: currency, grossAmount: amount, fee: "0", paymentAmount: paid || "0",
          paymentAccountId: accountId || null, customerId: kind === "income" ? customerId || null : null,
          supplierId: kind === "expense" ? supplierId || null : null, description, baseRate: baseRate || undefined,
          notes: "Draft pending owner review.", idempotencyKey: `income-expense-${crypto.randomUUID()}`,
        },
      });
      onCreated(result.transaction);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Draft could not be created."); }
    finally { setBusy(false); }
  }
  return <Modal title={kind === "income" ? "Record income" : "Record expense"} subtitle="Draft only · posted after owner approval" onClose={onClose} footer={<><button className="btn btn-outline" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="income-draft" type="submit" disabled={busy}>{busy ? "Saving…" : "Create financial draft"}</button></>}>
    {error && <div className="alert" role="alert">{error}</div>}
    <div className="segment-control" style={{ marginBottom: 16 }}><button type="button" className={kind === "expense" ? "active" : ""} onClick={() => setKind("expense")}>Expense</button><button type="button" className={kind === "income" ? "active" : ""} onClick={() => setKind("income")}>Income</button></div>
    <form id="income-draft" onSubmit={submit} className="form-grid">
      <SelectField label="Currency" value={currency} onChange={(value) => { setCurrency(value); setAccountId(""); }} options={currencies.filter((item) => item.active).map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` }))} required />
      <TextField label="Amount" value={amount} onChange={setAmount} placeholder="0.00" inputMode="decimal" required />
      <TextField label="Amount actually paid / received" value={paid} onChange={setPaid} placeholder="0.00" inputMode="decimal" hint="Enter 0 if not settled yet." />
      <SelectField label={kind === "income" ? "Cash / bank receiving account" : "Cash / bank payment account"} value={accountId} onChange={setAccountId} options={cashAccounts.map((item) => ({ value: item.id, label: item.name }))} placeholder="Not selected" />
      {kind === "income" ? <SelectField label="Customer (if balance due)" value={customerId} onChange={setCustomerId} options={customers.map((item) => ({ value: item.id, label: item.name }))} placeholder="Choose customer" /> : <SelectField label="Supplier (if balance due)" value={supplierId} onChange={setSupplierId} options={suppliers.map((item) => ({ value: item.id, label: item.name }))} placeholder="Choose supplier" />}
      {currency !== business.baseCurrency && <TextField label={`Reporting rate (${business.baseCurrency} per ${currency})`} value={baseRate} onChange={setBaseRate} placeholder="Explicit owner-entered rate" inputMode="decimal" required />}
      <TextField label="Description / category" value={description} onChange={setDescription} placeholder="Travel supplies, office expense…" full />
    </form>
  </Modal>;
}

export function ContactFormModal({ business, kind, onClose, onCreated }: { business: Business; kind: "customer" | "supplier"; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [email, setEmail] = useState(""); const [notes, setNotes] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { await apiRequest(kind === "customer" ? "customers" : "suppliers", { method: "POST", businessId: business.id, body: { name, phone, email, notes } }); onCreated(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Contact could not be saved."); }
    finally { setBusy(false); }
  }
  return <Modal title={`Add ${kind}`} subtitle={`This ${kind} record belongs only to ${business.name}.`} onClose={onClose} footer={<><button className="btn btn-outline" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" form="contact-form" disabled={busy}>{busy ? "Saving…" : `Save ${kind}`}</button></>}>
    {error && <div className="alert" role="alert">{error}</div>}
    <form id="contact-form" className="form-grid" onSubmit={submit}>
      <TextField label="Name" value={name} onChange={setName} placeholder={`Full ${kind} name`} required full />
      <TextField label="Phone" value={phone} onChange={setPhone} placeholder="Optional phone" />
      <TextField label="Email" type="email" value={email} onChange={setEmail} placeholder="Optional email" />
      <TextAreaField label="Private note" value={notes} onChange={setNotes} placeholder="Do not store passport or sensitive data here." full />
    </form>
  </Modal>;
}

export function PaymentFormModal({ business, contact, kind, balances, currencies, accounts, onClose, onCreated }: {
  business: Business; contact: Contact; kind: "customer_payment" | "supplier_payment"; balances: ContactBalance[]; currencies: Currency[]; accounts: Account[]; onClose: () => void; onCreated: Created;
}) {
  const options = balances.filter((balance) => parseFloat(balance.balance) > 0).map((balance) => balance.currency);
  const [currency, setCurrency] = useState(options[0] ?? business.baseCurrency);
  const [amount, setAmount] = useState(""); const [accountId, setAccountId] = useState(""); const [baseRate, setBaseRate] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const due = balances.find((balance) => balance.currency === currency)?.balance ?? "0";
  const cashAccounts = accounts.filter((account) => account.active && ["cash", "bank"].includes(account.type) && account.currencyCode === currency);
  const currencyName = currencies.find((item) => item.code === currency)?.name ?? currency;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await apiRequest<{ transaction: Transaction }>("transactions", {
        method: "POST", businessId: business.id,
        body: {
          kind, settlementCurrency: currency, grossAmount: amount, paymentAmount: amount,
          paymentAccountId: accountId || null, customerId: kind === "customer_payment" ? contact.id : null,
          supplierId: kind === "supplier_payment" ? contact.id : null, baseRate: baseRate || undefined,
          fee: "0", description: `${kind === "customer_payment" ? "Payment from" : "Payment to"} ${contact.name}`,
          idempotencyKey: `contact-payment-${crypto.randomUUID()}`,
        },
      });
      onCreated(result.transaction);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Payment draft could not be created."); }
    finally { setBusy(false); }
  }
  return <Modal title={kind === "customer_payment" ? "Record customer payment" : "Record supplier payment"} subtitle={`${contact.name} · Payment remains a draft until owner approval`} onClose={onClose} footer={<><button className="btn btn-outline" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" form="payment-form" disabled={busy}>{busy ? "Saving…" : "Create payment draft"}</button></>}>
    {error && <div className="alert" role="alert">{error}</div>}
    <div className="callout info" style={{ marginBottom: 14 }}><Icon name="wallet" />Open balance: {due} {currency} · Amounts are kept separate by currency.</div>
    <form id="payment-form" className="form-grid" onSubmit={submit}>
      <SelectField label="Balance currency" value={currency} onChange={(value) => { setCurrency(value); setAccountId(""); }} options={options.map((code) => ({ value: code, label: `${code} · ${currencies.find((item) => item.code === code)?.name ?? code}` }))} required />
      <TextField label="Payment amount" value={amount} onChange={setAmount} placeholder="0.00" inputMode="decimal" required hint={`Cannot exceed ${due} ${currency}.`} />
      <SelectField label={kind === "customer_payment" ? "Deposit into" : "Pay from"} value={accountId} onChange={setAccountId} options={cashAccounts.map((account) => ({ value: account.id, label: account.name }))} placeholder="Choose cash or bank account" required full />
      {currency !== business.baseCurrency && <TextField label={`Reporting rate (${business.baseCurrency} per ${currency})`} value={baseRate} onChange={setBaseRate} placeholder="Owner-entered conversion rate" required inputMode="decimal" hint={`Currency: ${currencyName}`} full />}
    </form>
    <div className="callout warn" style={{ marginTop: 13 }}><Icon name="shield" />This payment reduces the existing receivable/payable; it does not create duplicate income or expense.</div>
  </Modal>;
}

export function AccountFormModal({ business, currencies, onClose, onCreated }: { business: Business; currencies: Currency[]; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState(""); const [type, setType] = useState("cash"); const [currency, setCurrency] = useState(business.baseCurrency); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { await apiRequest("accounts", { method: "POST", businessId: business.id, body: { name, type, currencyCode: currency } }); onCreated(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Account could not be created."); }
    finally { setBusy(false); }
  }
  return <Modal title="Add cash or bank account" subtitle="Balances remain separate by currency." onClose={onClose} footer={<><button className="btn btn-outline" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" form="account-form" disabled={busy}>{busy ? "Saving…" : "Add account"}</button></>}>
    {error && <div className="alert">{error}</div>}
    <form id="account-form" className="form-grid" onSubmit={submit}>
      <TextField label="Account name" value={name} onChange={setName} placeholder="Front desk cash" required full />
      <SelectField label="Account type" value={type} onChange={setType} options={[{ value: "cash", label: "Cash" }, { value: "bank", label: "Bank" }]} required />
      <SelectField label="Currency" value={currency} onChange={setCurrency} options={currencies.filter((item) => item.active).map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` }))} required />
    </form>
  </Modal>;
}

export function BusinessFormModal({ onClose, onCreated }: { onClose: () => void; onCreated: (business: Business) => void }) {
  const [name, setName] = useState(""); const [category, setCategory] = useState("currency_exchange"); const [baseCurrency, setBaseCurrency] = useState("EGP"); const [timezone, setTimezone] = useState("Africa/Cairo"); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await apiRequest<{ business: Business }>("businesses", { method: "POST", body: { name, category, baseCurrency, timezone } }); onCreated(result.business); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Workspace could not be created."); }
    finally { setBusy(false); }
  }
  return <Modal title="Add a business workspace" subtitle="New workspace data, transactions, accounts, and receipts stay separate." onClose={onClose} footer={<><button className="btn btn-outline" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" form="business-form" disabled={busy}>{busy ? "Creating…" : "Create workspace"}</button></>}>
    {error && <div className="alert">{error}</div>}
    <form id="business-form" onSubmit={submit} className="form-grid">
      <TextField label="Business name" value={name} onChange={setName} placeholder="Your business name" required full />
      <SelectField label="Business category" value={category} onChange={setCategory} options={[{ value: "currency_exchange", label: "Currency exchange" }, { value: "travel_agency", label: "Travel agency" }, { value: "other", label: "Other" }]} required />
      <SelectField label="Reporting currency" value={baseCurrency} onChange={setBaseCurrency} options={[{ value: "EGP", label: "EGP · Egyptian pound" }, { value: "USD", label: "USD · US dollar" }, { value: "GBP", label: "GBP · British pound" }, { value: "BDT", label: "BDT · Bangladeshi taka" }]} required />
      <TextField label="Time zone" value={timezone} onChange={setTimezone} placeholder="Africa/Cairo" required full />
    </form>
    <div className="callout info" style={{ marginTop: 12 }}><Icon name="building" />Contact details and company registration fields are left blank until the owner supplies them.</div>
  </Modal>;
}

export function CurrencyFormModal({ business, onClose, onCreated }: { business: Business; onClose: () => void; onCreated: () => void }) {
  const [code, setCode] = useState(""); const [name, setName] = useState(""); const [symbol, setSymbol] = useState(""); const [places, setPlaces] = useState("2"); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { await apiRequest("currencies", { method: "POST", businessId: business.id, body: { code: code.toUpperCase(), name, symbol, decimalPlaces: Number(places) } }); onCreated(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Currency could not be enabled."); }
    finally { setBusy(false); }
  }
  return <Modal title="Enable a currency" subtitle="System ledger accounts are created separately for this currency." onClose={onClose} footer={<><button className="btn btn-outline" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" form="currency-form" disabled={busy}>{busy ? "Adding…" : "Enable currency"}</button></>}>
    {error && <div className="alert">{error}</div>}
    <form id="currency-form" onSubmit={submit} className="form-grid">
      <TextField label="ISO / explicit code" value={code} onChange={(value) => setCode(value.toUpperCase())} placeholder="JPY" required />
      <TextField label="Display name" value={name} onChange={setName} placeholder="Japanese yen" required />
      <TextField label="Symbol" value={symbol} onChange={setSymbol} placeholder="¥" required />
      <SelectField label="Decimal places" value={places} onChange={setPlaces} options={[{ value: "0", label: "0 (whole units)" }, { value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }]} required />
    </form>
  </Modal>;
}

export function StaffFormModal({ business, onClose, onCreated }: { business: Business; onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState(""); const [role, setRole] = useState("staff"); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { await apiRequest("staff", { method: "POST", businessId: business.id, body: { email, role } }); onCreated(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Workspace access could not be granted."); }
    finally { setBusy(false); }
  }
  return <Modal title="Grant workspace access" subtitle="The person must already have an account. Invitations are not sent without verified email delivery." onClose={onClose} footer={<><button className="btn btn-outline" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" form="staff-form" disabled={busy}>{busy ? "Saving…" : "Grant access"}</button></>}>
    {error && <div className="alert">{error}</div>}
    <form id="staff-form" className="form-grid" onSubmit={submit}>
      <TextField label="Registered account email" type="email" value={email} onChange={setEmail} placeholder="teammate@example.com" required full />
      <SelectField label="Role" value={role} onChange={setRole} options={[{ value: "manager", label: "Manager · limited operational access" }, { value: "staff", label: "Staff · create drafts and manage contacts" }, { value: "viewer", label: "Viewer · view only" }]} required full />
    </form>
    <div className="callout warn" style={{ marginTop: 12 }}><Icon name="shield" />No non-owner role can approve or reverse a financial posting.</div>
  </Modal>;
}
