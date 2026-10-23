"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/client-api";
import { decimalString, parseDecimal } from "@/lib/decimal";
import { Icon, Modal, StatusPill } from "@/components/common";
import type { Account, Business, Contact, Transaction } from "@/components/app-types";

type ReviewResult = {
  transaction: Transaction;
  customerName: string | null;
  supplierName: string | null;
  booking: {
    bookingStatus: string;
    bookingReference: string | null;
    passengerName: string | null;
    airlineName: string | null;
    origin: string | null;
    destination: string | null;
    travelDate: string | null;
    serviceDescription: string | null;
    saleAmount: string;
    costAmount: string;
    currencyCode: string;
  } | null;
  impact: Record<string, unknown> | null;
};

export function ReviewModal({ transactionId, business, accounts, customers, suppliers, isOwner, onClose, onChanged, onReceipt }: {
  transactionId: string; business: Business; accounts: Account[]; customers: Contact[]; suppliers: Contact[]; isOwner: boolean;
  onClose: () => void; onChanged: (transaction: Transaction) => void; onReceipt: (transactionId: string) => void;
}) {
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("0");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [supplierPaidAmount, setSupplierPaidAmount] = useState("0");
  const [supplierPaymentAccountId, setSupplierPaymentAccountId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const data = await apiRequest<ReviewResult>(`transactions/${transactionId}`, { businessId: business.id });
      setResult(data);
      setPaymentAmount(data.transaction.paymentAmount ?? "0");
      setPaymentAccountId(data.transaction.paymentAccountId ?? "");
      setSupplierPaidAmount(data.transaction.supplierPaidAmount ?? "0");
      setSupplierPaymentAccountId(data.transaction.supplierPaymentAccountId ?? "");
      setCustomerId(data.transaction.customerId ?? "");
      setSupplierId(data.transaction.supplierId ?? "");
      setNotes(data.transaction.notes ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Transaction could not be loaded."); }
    finally { setLoading(false); }
  }, [business.id, transactionId]);

  useEffect(() => { void load(); }, [load]);

  const transaction = result?.transaction;
  const settlement = transaction?.settlementCurrency ?? "";
  const eligibleAccounts = useMemo(() => accounts.filter((account) => account.active && ["cash", "bank"].includes(account.type) && account.currencyCode === settlement), [accounts, settlement]);
  const editable = transaction?.status === "draft" && transaction.kind !== "reversal";
  const total = transaction?.totalAmount ? parseDecimal(transaction.totalAmount) : BigInt(0);
  const paid = paymentAmount ? parseDecimal(paymentAmount) : BigInt(0);
  const due = decimalString(total - paid);
  const unresolved: string[] = [];
  if (transaction?.status === "draft") {
    if (!transaction.baseRate && settlement !== business.baseCurrency) unresolved.push(`Enter the owner-approved ${settlement} to ${business.baseCurrency} reporting rate.`);
    if (paid > BigInt(0) && !paymentAccountId) unresolved.push("Choose the cash or bank account used for the actual payment.");
    if (transaction.kind === "fx_purchase" && parseDecimal(due) > BigInt(0) && !supplierId) unresolved.push("Identify a supplier or record the purchase as fully paid.");
    if (transaction.kind === "fx_sale" && parseDecimal(due) > BigInt(0) && !customerId) unresolved.push("Identify a customer or record the full sale proceeds as received.");
    if ((transaction.kind === "ticket" || transaction.kind === "umrah") && parseDecimal(due) > BigInt(0) && !customerId) unresolved.push("Identify the customer or record the full amount received.");
    if ((transaction.kind === "ticket" || transaction.kind === "umrah") && parseDecimal(transaction.costAmount || "0") > BigInt(0) && parseDecimal(supplierPaidAmount || "0") < parseDecimal(transaction.costAmount) && !supplierId) unresolved.push("Identify the supplier for the unpaid service cost.");
  }
  const blockedByStock = result?.impact?.blocked === true;
  const canApprove = isOwner && transaction?.status === "draft" && unresolved.length === 0 && !blockedByStock && !saving;

  async function saveDraft() {
    if (!transaction) return;
    setSaving(true); setError(""); setSuccess("");
    try {
      const data = await apiRequest<{ transaction: Transaction }>(`transactions/${transaction.id}`, {
        method: "PATCH", businessId: business.id,
        body: {
          expectedVersion: transaction.version,
          paymentAmount,
          paymentAccountId: paymentAccountId || null,
          supplierPaidAmount,
          supplierPaymentAccountId: supplierPaymentAccountId || null,
          customerId: customerId || null,
          supplierId: supplierId || null,
          notes,
        },
      });
      onChanged(data.transaction);
      setSuccess("Draft updated. Review the new version before approval.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Draft could not be updated."); }
    finally { setSaving(false); }
  }

  async function approve() {
    if (!transaction) return;
    setSaving(true); setError(""); setSuccess("");
    try {
      const data = await apiRequest<{ transaction: Transaction }>(`transactions/${transaction.id}/approve`, {
        method: "POST", businessId: business.id, body: { expectedVersion: transaction.version },
      });
      onChanged(data.transaction);
      setSuccess(`Posted successfully. Receipt ${data.transaction.receiptNumber} is ready.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Transaction could not be posted."); }
    finally { setSaving(false); }
  }

  async function reject() {
    if (!transaction) return;
    setSaving(true); setError("");
    try {
      const data = await apiRequest<{ transaction: Transaction }>(`transactions/${transaction.id}/reject`, {
        method: "POST", businessId: business.id, body: { expectedVersion: transaction.version, reason: rejectionReason || "Rejected by owner" },
      });
      onChanged(data.transaction); setSuccess("Draft rejected. No journal entries or balance changes were created."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Draft could not be rejected."); }
    finally { setSaving(false); }
  }

  async function createReversal() {
    if (!transaction) return;
    setSaving(true); setError("");
    try {
      const data = await apiRequest<{ transaction: Transaction }>(`transactions/${transaction.id}/reverse`, { method: "POST", businessId: business.id, body: {} });
      onChanged(data.transaction); setSuccess("Reversal draft created. It requires a separate owner approval before posting."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Reversal draft could not be created."); }
    finally { setSaving(false); }
  }

  const title = transaction ? transaction.kind.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Review transaction";
  const amountText = transaction?.totalAmount ? `${transaction.totalAmount} ${transaction.settlementCurrency}` : "—";
  const footer = transaction ? <>
    {transaction.status === "posted" && <>
      <button type="button" className="btn btn-outline" onClick={() => onReceipt(transaction.id)}><Icon name="receipt" size={15} />View receipt</button>
      {isOwner && !transaction.reversedById && <button type="button" className="btn btn-danger" onClick={createReversal} disabled={saving}><Icon name="refresh" size={15} />Create reversal draft</button>}
    </>}
    {editable && <>
      <button type="button" className="btn btn-outline" onClick={saveDraft} disabled={saving}>Save draft changes</button>
      {isOwner && <button type="button" className="btn btn-outline" onClick={reject} disabled={saving}>Reject draft</button>}
      {isOwner && <button type="button" className="btn btn-primary" onClick={approve} disabled={!canApprove}><Icon name="shield" size={15} />{saving ? "Posting…" : "Approve & post"}</button>}
    </>}
  </> : undefined;

  return <Modal title={title} subtitle="Server-calculated preview · Owner authorization is checked again during posting" onClose={onClose} wide footer={footer}>
    {loading && <div className="empty-state"><span className="spinner" /></div>}
    {error && <div className="alert" role="alert">{error}</div>}
    {success && <div className="success-note" role="status">{success}</div>}
    {!loading && transaction && <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 15 }}>
        <div><div className="eyebrow">Transaction {transaction.id.slice(0, 8).toUpperCase()}</div><div style={{ marginTop: 6 }}><StatusPill status={transaction.status} /> {transaction.receiptNumber && <span className="table-secondary" style={{ display: "inline", marginLeft: 7 }}>{transaction.receiptNumber}</span>}</div></div>
        <div style={{ textAlign: "right" }}><small className="subtle">Transaction amount</small><div style={{ fontSize: 18, fontWeight: 760, color: "#20334a", marginTop: 4 }}>{amountText}</div></div>
      </div>
      <div className="stat-pair" style={{ marginBottom: 13 }}>
        <div className="stat-tile"><small>Business</small><strong style={{ fontSize: 11 }}>{business.name}</strong></div>
        <div className="stat-tile"><small>Recorded date</small><strong style={{ fontSize: 11 }}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(transaction.transactionDate))}</strong></div>
        {transaction.kind.startsWith("fx_") && <>
          <div className="stat-tile"><small>{transaction.kind === "fx_purchase" ? "Currency acquired" : "Currency sold"}</small><strong>{transaction.quantity} {transaction.tradedCurrency}</strong></div>
          <div className="stat-tile"><small>Owner-entered rate</small><strong>{transaction.rate} {transaction.settlementCurrency} / {transaction.tradedCurrency}</strong></div>
        </>}
        {result?.booking && <>
          <div className="stat-tile"><small>Service status</small><strong><StatusPill status={result.booking.bookingStatus} /></strong></div>
          <div className="stat-tile"><small>Booking reference</small><strong>{result.booking.bookingReference || "Not recorded"}</strong></div>
          <div className="stat-tile"><small>Passenger</small><strong>{result.booking.passengerName || "Not recorded"}</strong></div>
          <div className="stat-tile"><small>Travel date</small><strong>{result.booking.travelDate ? new Date(result.booking.travelDate).toLocaleDateString() : "Not recorded"}</strong></div>
        </>}
        <div className="stat-tile"><small>Amount paid / received</small><strong>{paymentAmount} {settlement}</strong></div>
        <div className="stat-tile"><small>Outstanding amount</small><strong>{due} {settlement}</strong></div>
      </div>
      {result?.impact && <div className="panel" style={{ padding: 14, marginBottom: 13, background: "#f8fbfa" }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Expected accounting impact</div>
        {typeof result.impact.inventoryEffect === "string" && <div style={{ fontSize: 10, color: "#456960", marginBottom: 6 }}>{result.impact.inventoryEffect}</div>}
        {typeof result.impact.expectedCost === "string" && <div style={{ fontSize: 10, color: "#59697b", marginTop: 5 }}>Weighted-average cost: {result.impact.expectedCost} {business.baseCurrency}</div>}
        {typeof result.impact.expectedRealizedProfit === "string" && <div style={{ fontSize: 10, color: "#1b7469", fontWeight: 750, marginTop: 5 }}>Expected realized profit/loss: {result.impact.expectedRealizedProfit} {business.baseCurrency}</div>}
        {typeof result.impact.preliminaryMargin === "string" && <div style={{ fontSize: 10, color: "#59697b", marginTop: 5 }}>Preliminary margin: {result.impact.preliminaryMargin} {settlement} before additional costs.</div>}
        {typeof result.impact.availableStock === "string" && <div style={{ fontSize: 10, color: "#59697b", marginTop: 5 }}>Approved stock available: {result.impact.availableStock} {transaction.tradedCurrency}</div>}
        {typeof result.impact.warning === "string" && <div className="callout warn" style={{ marginTop: 9 }}><Icon name="warning" />{result.impact.warning}</div>}
      </div>}
      {transaction.status === "draft" && unresolved.length > 0 && <div className="callout warn" style={{ marginBottom: 13 }}><Icon name="warning" /><div>{unresolved.map((item) => <div key={item}>{item}</div>)}</div></div>}
      {blockedByStock && <div className="callout warn" style={{ marginBottom: 13 }}><Icon name="warning" />Insufficient approved currency inventory. This posting is blocked; drafts cannot create negative stock.</div>}
      {editable && <div className="form-section"><div className="form-section-title"><strong>Confirm settlement details</strong><small>Changing these invalidates the previous preview.</small></div><div className="form-grid three">
        {transaction.kind !== "reversal" && transaction.totalAmount && <>
          <div className="field"><label>{transaction.kind === "fx_purchase" || transaction.kind === "expense" || transaction.kind === "supplier_payment" ? "Amount paid" : "Amount received"}</label><input value={paymentAmount} inputMode="decimal" onChange={(event) => setPaymentAmount(event.target.value)} /><span className="field-hint">Total: {amountText}</span></div>
          <div className="field"><label>{transaction.kind === "fx_purchase" || transaction.kind === "expense" || transaction.kind === "supplier_payment" ? "Payment account" : "Receiving account"}</label><select value={paymentAccountId} onChange={(event) => setPaymentAccountId(event.target.value)}><option value="">Not selected</option>{eligibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currencyCode}</option>)}</select></div>
        </>}
        {(transaction.kind === "fx_sale" || transaction.kind === "ticket" || transaction.kind === "umrah" || transaction.kind === "income") && <div className="field"><label>Customer</label><select value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">Not selected</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select><span className="field-hint">Required if an amount remains outstanding.</span></div>}
        {(transaction.kind === "fx_purchase" || transaction.kind === "ticket" || transaction.kind === "umrah" || transaction.kind === "expense") && <div className="field"><label>Supplier</label><select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">Not selected</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select><span className="field-hint">Required for an unpaid purchase or service cost.</span></div>}
        {(transaction.kind === "ticket" || transaction.kind === "umrah") && <>
          <div className="field"><label>Supplier amount paid</label><input value={supplierPaidAmount} inputMode="decimal" onChange={(event) => setSupplierPaidAmount(event.target.value)} /></div>
          <div className="field"><label>Supplier payment account</label><select value={supplierPaymentAccountId} onChange={(event) => setSupplierPaymentAccountId(event.target.value)}><option value="">Not selected</option>{eligibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currencyCode}</option>)}</select></div>
        </>}
        <div className="field full"><label>Internal note</label><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Owner-only accounting note" /></div>
        {isOwner && <div className="field full"><label>Rejection reason (optional)</label><input value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Only used if you reject this draft" /></div>}
      </div></div>}
      {transaction.status === "draft" && !isOwner && <div className="callout info"><Icon name="shield" />This draft is awaiting an owner decision. Your role cannot approve or post it.</div>}
      {transaction.status === "posted" && <div className="callout good"><Icon name="circleCheck" />This transaction is finalized and immutable. Corrections require a separately approved reversal. {transaction.reversedById ? "A reversal has been posted." : ""}</div>}
      {transaction.status === "rejected" && <div className="callout warn"><Icon name="x" />Rejected: {transaction.rejectionReason || "No reason recorded."} No financial entries were posted.</div>}
      {transaction.reversalOfId && <div className="callout warn" style={{ marginTop: 10 }}><Icon name="refresh" />This is a reversal draft. Approval will mirror the original balanced journal exactly and preserve the audit trail.</div>}
      {transaction.receiptNumber && <div className="field-hint" style={{ marginTop: 12 }}>Official receipt number: {transaction.receiptNumber}. Customer receipt details exclude internal cost, margins, and notes.</div>}
    </>}
  </Modal>;
}
