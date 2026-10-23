"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/client-api";
import { Icon, Modal, StatusPill } from "@/components/common";
import type { Business, Contact, ContactDetail } from "@/components/app-types";

export function ContactStatementModal({ business, kind, contactId, onClose, onPayment }: {
  business: Business; kind: "customer" | "supplier"; contactId: string; onClose: () => void;
  onPayment: (contact: Contact, kind: "customer_payment" | "supplier_payment", balances: ContactDetail["balances"]) => void;
}) {
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    apiRequest<ContactDetail>(kind === "customer" ? "customers" : "suppliers", { businessId: business.id, params: { id: contactId } })
      .then((value) => { if (active) setDetail(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Statement could not be loaded."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [business.id, contactId, kind]);

  const balances = detail?.balances.filter((balance) => balance.balance !== "0") ?? [];
  return <Modal title={detail?.contact.name ?? `${kind} statement`} subtitle={`${business.name} · Separate balance by currency`} onClose={onClose} wide footer={detail ? <>
    <button type="button" className="btn btn-outline" onClick={onClose}>Close statement</button>
    <button type="button" className="btn btn-primary" onClick={() => onPayment(detail.contact, kind === "customer" ? "customer_payment" : "supplier_payment", detail.balances)}><Icon name="wallet" size={15} />Record payment draft</button>
  </> : undefined}>
    {busy && <div className="empty-state"><span className="spinner" /></div>}
    {error && <div className="alert" role="alert">{error}</div>}
    {detail && <>
      <div className="stat-pair" style={{ marginBottom: 17 }}>
        <div className="stat-tile"><small>Contact</small><strong style={{ fontSize: 12 }}>{detail.contact.name}</strong></div>
        <div className="stat-tile"><small>Contact type</small><strong style={{ fontSize: 12, textTransform: "capitalize" }}>{kind}</strong></div>
        {detail.contact.phone && <div className="stat-tile"><small>Phone</small><strong style={{ fontSize: 11 }}>{detail.contact.phone}</strong></div>}
        {detail.contact.email && <div className="stat-tile"><small>Email</small><strong style={{ fontSize: 11 }}>{detail.contact.email}</strong></div>}
      </div>
      <div className="panel" style={{ padding: 14, marginBottom: 16 }}>
        <div className="panel-header"><div><h2>{kind === "customer" ? "Outstanding receivables" : "Outstanding payables"}</h2><p>Approved ledger balances only</p></div></div>
        {balances.length === 0 ? <div className="field-hint">No open posted balances.</div> : <div className="stock-list">{balances.map((balance) => <div className="stock-row" key={balance.currency}><div className="currency-badge">{balance.currency}</div><div className="stock-info"><strong>{kind === "customer" ? "Amount due from customer" : "Amount due to supplier"}</strong><small>Balance tracked in this currency</small></div><div className="stock-qty">{balance.balance}<small>{balance.currency}</small></div></div>)}</div>}
      </div>
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-header"><div><h2>Account history</h2><p>Drafts and finalized records for this contact</p></div></div>
        {detail.history.length === 0 ? <div className="empty-state"><div className="empty-state-icon"><Icon name="file" /></div><h3>No transactions yet</h3><p>Approved activity and drafts for this contact will appear here.</p></div> : <div className="table-wrap"><table className="data-table" style={{ minWidth: 560 }}><thead><tr><th>Date</th><th>Entry</th><th>Amount</th><th>Status</th></tr></thead><tbody>{detail.history.map(({ transaction, booking }) => <tr key={transaction.id}><td>{new Date(transaction.transactionDate).toLocaleDateString()}</td><td><span className="table-primary">{transaction.description || transaction.kind.replaceAll("_", " ")}</span>{booking?.bookingReference && <span className="table-secondary">Ref · {booking.bookingReference}</span>}</td><td>{transaction.totalAmount ?? "—"} {transaction.settlementCurrency}</td><td><StatusPill status={transaction.status} /></td></tr>)}</tbody></table></div>}
      </div>
      {detail.contact.notes && <div className="callout info" style={{ marginTop: 12 }}><Icon name="file" />Private note: {detail.contact.notes}</div>}
    </>}
  </Modal>;
}
