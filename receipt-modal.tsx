"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/client-api";
import { Icon, Modal } from "@/components/common";
import type { Business, ReceiptDocument } from "@/components/app-types";

async function renderReceiptImage(document: ReceiptDocument): Promise<Blob> {
  const canvas = window.document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 1500;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image export is not supported in this browser.");
  const primary = document.primaryColor || "#13243d";
  const accent = document.accentColor || "#c9a66b";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = accent;
  context.fillRect(0, 0, canvas.width, 13);
  context.fillStyle = primary;
  context.fillRect(0, 13, canvas.width, 3);

  let y = 83;
  let logoLoaded = false;
  if (document.logoUrl?.startsWith("/")) {
    try {
      const image = new Image();
      image.src = document.logoUrl;
      await new Promise<void>((resolve) => {
        image.onload = () => resolve();
        image.onerror = () => resolve();
      });
      if (image.complete && image.naturalWidth > 0) {
        const height = 94;
        const width = Math.min(360, (image.naturalWidth / image.naturalHeight) * height);
        context.drawImage(image, 74, 48, width, height);
        logoLoaded = true;
      }
    } catch { /* use the business name fallback */ }
  }
  if (!logoLoaded) {
    context.fillStyle = primary;
    context.font = "700 32px Arial";
    context.fillText(document.businessName, 74, y);
  }
  context.textAlign = "right";
  context.fillStyle = "#84909d";
  context.font = "600 16px Arial";
  context.fillText("RECEIPT REFERENCE", 1126, 62);
  context.fillStyle = "#26394f";
  context.font = "700 20px Arial";
  context.fillText(document.receiptNumber, 1126, 93);
  context.textAlign = "left";
  y = 183;
  context.strokeStyle = accent;
  context.lineWidth = 3;
  context.beginPath(); context.moveTo(74, y); context.lineTo(1126, y); context.stroke();
  y += 69;
  context.fillStyle = primary;
  context.font = "700 32px Arial";
  context.fillText(document.title, 74, y);
  y += 44;
  context.fillStyle = "#768394";
  context.font = "16px Arial";
  const dateText = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(document.transactionDate));
  context.fillText(dateText, 74, y);
  y += 70;

  const fields: Array<[string, string]> = [];
  if (document.customerName) fields.push(["CUSTOMER", document.customerName]);
  if (document.kind.startsWith("fx_") && document.quantity && document.tradedCurrency) fields.push(["CURRENCY / QUANTITY", `${document.quantity} ${document.tradedCurrency}`]);
  if (document.rate && document.tradedCurrency) fields.push(["EXCHANGE RATE", `${document.rate} ${document.currency} per ${document.tradedCurrency}`]);
  if (document.fee && document.fee !== "0") fields.push(["FEE / AGENCY CHARGE", `${document.fee} ${document.currency}`]);
  if (document.booking?.bookingReference) fields.push(["BOOKING REFERENCE", document.booking.bookingReference]);
  if (document.booking?.serviceDescription) fields.push(["SERVICE", document.booking.serviceDescription]);
  if (document.booking?.airlineName) fields.push(["AIRLINE", document.booking.airlineName]);
  if (document.booking?.origin || document.booking?.destination) fields.push(["ROUTE", [document.booking.origin, document.booking.destination].filter(Boolean).join(" → ")]);
  if (document.booking?.travelDate) fields.push(["TRAVEL DATE", new Date(document.booking.travelDate).toLocaleDateString()]);
  if (document.booking?.status) fields.push(["BOOKING STATUS", document.booking.status.toUpperCase()]);
  if (document.description && !document.booking?.serviceDescription) fields.push(["DESCRIPTION", document.description]);
  fields.push(["PAYMENT STATUS", document.paymentStatus.toUpperCase()]);

  const left = 74;
  const columnGap = 54;
  const columnWidth = 485;
  for (let index = 0; index < fields.length; index += 1) {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = left + column * (columnWidth + columnGap);
    const fieldY = y + row * 100;
    context.fillStyle = "#8994a1";
    context.font = "600 14px Arial";
    context.fillText(fields[index][0], x, fieldY);
    context.fillStyle = "#35465a";
    context.font = "600 19px Arial";
    const value = fields[index][1].length > 42 ? `${fields[index][1].slice(0, 40)}…` : fields[index][1];
    context.fillText(value, x, fieldY + 33);
    context.strokeStyle = "#edf0f2";
    context.lineWidth = 1;
    context.beginPath(); context.moveTo(x, fieldY + 51); context.lineTo(x + columnWidth, fieldY + 51); context.stroke();
  }
  y += Math.ceil(fields.length / 2) * 100 + 18;
  context.fillStyle = primary;
  context.beginPath(); context.roundRect(74, y, 1052, 118, 15); context.fill();
  context.fillStyle = "#d9e0e7";
  context.font = "600 15px Arial";
  context.fillText("TOTAL AMOUNT", 105, y + 42);
  context.fillStyle = "#ffffff";
  context.font = "700 31px Arial";
  context.fillText(`${document.totalAmount ?? "—"} ${document.currency ?? ""}`, 105, y + 83);
  context.textAlign = "right";
  context.fillStyle = "#d9e0e7";
  context.font = "15px Arial";
  context.fillText(`Paid: ${document.amountPaid ?? "0"} ${document.currency ?? ""}`, 1092, y + 45);
  if (document.amountOutstanding && document.amountOutstanding !== "0") {
    context.fillText(`Balance due: ${document.amountOutstanding} ${document.currency ?? ""}`, 1092, y + 78);
  }
  context.textAlign = "left";
  y += 175;
  context.strokeStyle = "#dfe4e8";
  context.setLineDash([7, 7]);
  context.beginPath(); context.moveTo(74, y); context.lineTo(1126, y); context.stroke(); context.setLineDash([]);
  y += 44;
  const contactLine = [document.address, document.phone, document.email].filter(Boolean).join("  ·  ");
  context.fillStyle = "#7d8998";
  context.font = "14px Arial";
  if (contactLine) context.fillText(contactLine.slice(0, 110), 74, y);
  context.fillText("Thank you. This document reflects the recorded transaction status above.", 74, y + 29);
  context.textAlign = "right";
  context.fillStyle = "#43556a";
  context.font = "italic 15px Georgia";
  context.fillText("Authorized signature", 1126, y + 66);
  context.strokeStyle = "#adb7c1";
  context.beginPath(); context.moveTo(906, y + 47); context.lineTo(1126, y + 47); context.stroke();
  if (document.terms) {
    context.textAlign = "left";
    context.fillStyle = "#8994a1";
    context.font = "12px Arial";
    context.fillText(document.terms.slice(0, 150), 74, y + 95);
  }
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not render the receipt image.")), "image/png"));
}

export function ReceiptModal({ transactionId, business, onClose }: { transactionId: string; business: Business; onClose: () => void }) {
  const [document, setDocument] = useState<ReceiptDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    apiRequest<{ document: ReceiptDocument }>("receipts", { method: "POST", businessId: business.id, body: { transactionId } })
      .then((result) => { if (active) setDocument(result.document); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Receipt preview could not be generated."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [business.id, transactionId]);

  async function downloadPng() {
    if (!document) return null;
    setBusy(true); setError(""); setMessage("");
    try {
      const blob = await renderReceiptImage(document);
      const link = window.document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.href = url; link.download = `${document.receiptNumber}.png`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      setMessage("Receipt image downloaded.");
      return blob;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Image export failed.");
      return null;
    } finally { setBusy(false); }
  }

  async function shareFile() {
    if (!document) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const blob = await renderReceiptImage(document);
      const file = new File([blob], `${document.receiptNumber}.png`, { type: "image/png" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: `${document.businessName} · ${document.receiptNumber}`, text: "Choose a contact in your share sheet. This app cannot confirm delivery.", files: [file] });
        setMessage("The device share sheet opened. Select WhatsApp and the intended contact, then send manually. Delivery is not tracked here.");
        return;
      }
      const link = window.document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl; link.download = `${document.receiptNumber}.png`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      setMessage("Direct file sharing is unavailable. The PNG was downloaded; attach it manually in WhatsApp. No message was sent.");
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") setMessage("Sharing was cancelled. No message was sent.");
      else setError(cause instanceof Error ? cause.message : "The share sheet could not be opened.");
    } finally { setBusy(false); }
  }

  const brandColor = document?.primaryColor ?? "#13243d";
  return <Modal title="Final receipt preview" subtitle="Approved transaction · Customer-facing details only" onClose={onClose} wide footer={document ? <>
    <button className="btn btn-outline" type="button" onClick={() => window.print()}><Icon name="print" size={15} />Print / Save PDF</button>
    <button className="btn btn-outline" type="button" onClick={() => { void downloadPng(); }} disabled={busy}><Icon name="download" size={15} />Download PNG</button>
    <button className="btn btn-primary" type="button" onClick={() => { void shareFile(); }} disabled={busy}><Icon name="share" size={15} />Share / WhatsApp</button>
  </> : undefined}>
    {loading && <div className="empty-state"><span className="spinner" /></div>}
    {error && <div className="alert" role="alert">{error}</div>}
    {message && <div className="success-note" role="status">{message}</div>}
    {document && <div className="receipt-paper" style={{ "--receipt-primary": brandColor, "--receipt-accent": document.accentColor } as React.CSSProperties}>
      <div className="receipt-head">
        <div>{document.logoUrl ? <img src={document.logoUrl} alt={`${document.businessName} logo`} /> : <div style={{ color: brandColor, fontWeight: 800, fontSize: 16 }}>{document.businessName}</div>}
          <div style={{ color: "#8792a1", fontSize: 9, marginTop: 5 }}>{[document.address, document.phone, document.email].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="receipt-number"><small>Receipt reference</small><strong>{document.receiptNumber}</strong><small style={{ marginTop: 6 }}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(document.transactionDate))}</small></div>
      </div>
      <h2 className="receipt-title">{document.title}</h2>
      <div className="receipt-grid">
        {document.customerName && <div className="receipt-field"><small>Customer</small><strong>{document.customerName}</strong></div>}
        {document.kind.startsWith("fx_") && <div className="receipt-field"><small>Transaction</small><strong>{document.kind === "fx_purchase" ? "Currency purchase" : "Currency sale"}</strong></div>}
        {document.quantity && <div className="receipt-field"><small>Currency and quantity</small><strong>{document.quantity} {document.tradedCurrency}</strong></div>}
        {document.rate && <div className="receipt-field"><small>Exchange rate</small><strong>{document.rate} {document.currency} / {document.tradedCurrency}</strong></div>}
        {document.fee && document.fee !== "0" && <div className="receipt-field"><small>Fee / agency charge</small><strong>{document.fee} {document.currency}</strong></div>}
        {document.description && <div className="receipt-field"><small>Description</small><strong>{document.description}</strong></div>}
        {document.booking?.serviceDescription && <div className="receipt-field"><small>Service</small><strong>{document.booking.serviceDescription}</strong></div>}
        {document.booking?.bookingReference && <div className="receipt-field"><small>Booking reference</small><strong>{document.booking.bookingReference}</strong></div>}
        {document.booking?.airlineName && <div className="receipt-field"><small>Airline</small><strong>{document.booking.airlineName}</strong></div>}
        {(document.booking?.origin || document.booking?.destination) && <div className="receipt-field"><small>Route</small><strong>{[document.booking.origin, document.booking.destination].filter(Boolean).join(" → ")}</strong></div>}
        {document.booking?.travelDate && <div className="receipt-field"><small>Travel date</small><strong>{new Date(document.booking.travelDate).toLocaleDateString()}</strong></div>}
        {document.booking?.status && <div className="receipt-field"><small>Booking status</small><strong>{document.booking.status.toUpperCase()}</strong></div>}
        <div className="receipt-field"><small>Payment status</small><strong>{document.paymentStatus.toUpperCase()}</strong></div>
      </div>
      <div className="receipt-total"><div><small>Total amount</small><strong>{document.totalAmount ?? "—"} {document.currency}</strong></div><div style={{ textAlign: "right" }}><small>Amount paid</small><strong style={{ fontSize: 13 }}>{document.amountPaid ?? "0"} {document.currency}</strong>{document.amountOutstanding && document.amountOutstanding !== "0" && <small style={{ marginTop: 4 }}>Remaining: {document.amountOutstanding} {document.currency}</small>}</div></div>
      {document.terms && <div className="receipt-terms">{document.terms}</div>}
      <div className="receipt-footer"><span>This receipt reflects the transaction and payment status recorded above.</span><span className="receipt-signature">Authorized signature</span></div>
    </div>}
    <div className="callout info no-print" style={{ marginTop: 13 }}><Icon name="share" />Sharing is manual. The recipient is selected in your device’s share sheet or WhatsApp. The app cannot tell whether a message was sent or delivered.</div>
  </Modal>;
}
