# AI Business Manager & Accountant

A mobile-first, approval-first business management and accounting application for
**Osama Trusted Solutions** (currency exchange) and **Qasemi Tours and Travels**
(airline tickets, Umrah and travel services). Built with Next.js App Router,
PostgreSQL and Drizzle ORM.

---

## 1. What is implemented

**Workspaces & identity**
- Two pre-seeded, fully separated workspaces with the exact business names above.
- More workspaces can be added from the UI at runtime (no rebuild).
- Every transaction, inventory position, account, receipt and setting is scoped to
  one business. Cross-business records return `404`.
- Company address, phone, email, logo, brand colours and receipt terms are all
  owner-editable and **intentionally left blank** — nothing is invented.

**Accounting engine**
- Double-entry ledger. Every posting produces balanced journal lines in both the
  transaction currency and the business reporting (functional) currency.
- Exact fixed-point decimal arithmetic using `numeric` columns and `BigInt`
  scale-8 maths in TypeScript. **No binary floating point is ever used for money.**
- Moving **weighted-average cost** inventory valuation for currency stock.
- Realized exchange gain/loss, receivables, payables, revenue, expenses,
  cash/bank accounts, income and expense categories.
- Transaction currency and reporting currency are always kept separate. Different
  currencies are never added together; consolidated views show one report per
  business instead of a meaningless cross-currency sum.

**Owner approval workflow (enforced server-side)**
1. A user or the assistant creates a **draft**.
2. The server validates input, permissions and currency configuration.
3. The server calculates the expected impact (totals, stock, cost, profit).
4. The owner reviews a preview, may edit, then approves or rejects.
5. Any financial edit increments `version` and invalidates prior approval.
6. Posting happens inside one database transaction with row locks
   (`SELECT … FOR UPDATE`), an optimistic-version check, a unique idempotency key
   and a unique receipt number.
7. An audit event is recorded.

Repeated taps, retries and double-submits cannot post twice — approving an
already-posted transaction returns the same record without creating new entries.

**Immutability & correction**
Posted transactions cannot be edited or deleted. Corrections use an
owner-approved **reversal** that mirrors the original journal exactly and preserves
the audit trail. A purchase whose stock has already been issued cannot be reversed
until the related sale is reversed, so inventory never goes negative.

**Currency exchange (Osama Trusted Solutions)**
- Purchases and sales with explicit currency codes, quantity, owner-entered rate,
  rate direction, fees, location, counterparty and settlement account.
- Multiple purchase lots at different rates, partial sales, weighted-average cost,
  remaining stock, carrying value and average cost per currency.
- Sales are blocked when approved stock is insufficient.

**Travel agency (Qasemi Tours and Travels)**
- Ticket and Umrah bookings with reference, operational status (quotation /
  reserved / issued / paid / cancelled), passenger, airline, route, travel date.
- Customer selling price, agency charge, supplier cost (internal), payments
  received, supplier payments, outstanding customer and supplier balances.
- Status is never assumed: an unpaid booking cannot be marked `paid`, and nothing
  is auto-marked `issued`.

**Receipts & sharing**
- Branded, print-friendly (A4) receipts rendered from **approved, persisted**
  transactions only. Draft receipts are refused with `409`.
- Unique receipt numbers per business series.
- Print / Save-as-PDF via the browser print dialog, and a high-resolution PNG
  render for sharing.
- **Manual WhatsApp sharing** through the device share sheet
  (`navigator.share` with file support) with a download fallback. No WhatsApp
  Business API is required, and the app never claims delivery occurred.

**AI assistant**
- Text chat plus browser speech-to-text where the device supports it, and optional
  on-device text-to-speech.
- English, Bengali (including Bengali numerals) and Arabic, with RTL layout.
- Server-side structured tool calling with a strict allow-list. The assistant can
  read authorized records and create **drafts only** — it can never post, approve
  or reverse a financial transaction, and it cannot run arbitrary SQL.
- It assumes no payment account, counterparty or exchange rate, and asks for
  missing essentials instead of guessing.

**Security**
- Salted `scrypt` password hashes, HTTP-only session cookies, server-side
  authorization on every route, same-origin verification for all mutations.
- Role and permission model: only a workspace **owner** can approve, reverse or
  change settings. Managers/staff can draft and manage contacts and bookings.
  Viewers are read-only.

**PWA**
- Web manifest, theme colour and app icon for installable mobile use.

---

## 2. Logos and branding

Original, editable vector assets live in `public/branding/`:

| File | Purpose |
| --- | --- |
| `osama-trusted-solutions.svg` | OTS wordmark, light background |
| `osama-trusted-solutions-dark.svg` | OTS wordmark, dark background |
| `osama-trusted-symbol.svg` | OTS compact symbol for mobile headers |
| `qasemi-tours-and-travels.svg` | Qasemi wordmark, light background |
| `qasemi-tours-and-travels-dark.svg` | Qasemi wordmark, dark background |
| `qasemi-travel-symbol.svg` | Qasemi compass symbol |
| `app-icon.svg` | App / favicon mark |

OTS uses a navy `#13243d` + warm gold `#c9a66b` + white palette with an original
exchange/OTS monogram. Qasemi uses deep teal `#123c3c` + gold `#d2b679` + white
with an original compass/journey mark. Both are original designs and are
replaceable from **Business settings**.

---

## 3. Running locally

```bash
npm install
npx drizzle-kit push     # create tables in the configured database
npm run build
npm start                # serves on the PORT env var, default 3000
```

Open the app and you will be offered **owner setup** (first run only). Use a
password of at least 12 characters.

### Environment variables

`DATABASE_URL` is required and is read from `.env`:

```
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/app_db
```

### Optional: AI provider

The assistant works without any AI key using honest, clearly-labelled local
language rules. To enable a real model, set **server-side** environment variables:

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini        # optional
```

The key is only read on the server (`src/lib/assistant.ts`) and is never sent to
the browser. **Language & app** and **Business settings** show the live
configuration state and instructions; the app never pretends a provider is
connected when it is not.

### Optional: email delivery

Password recovery is intentionally disabled and returns a clear `503` message,
because no verified email-delivery provider is configured. Wire a verified SMTP
or transactional email service into `auth/recovery` before enabling it.

### Optional: WhatsApp Business API

Manual sharing needs no credentials. An official WhatsApp Business integration
(add-on for automated messaging, webhooks and delivery status) can be added later
behind the existing receipt-generation boundary.

---

## 4. Tests

```bash
npm test
```

Runs the financial-arithmetic suite (`tests/financial-math.test.ts`) using Node's
built-in test runner, covering:
- the currency purchase example (10,000 USD × 128.24 EGP = 1,282,400 EGP);
- weighted-average cost across multiple lots with a partial sale (cost, realized
  profit, remaining quantity and remaining value);
- half-up decimal rounding without floating point;
- rejection of excessive precision and malformed numeric input.

---

## 5. Project layout

```
src/db/schema.ts            Drizzle tables (users, businesses, ledger, bookings, audit…)
src/lib/decimal.ts          Exact fixed-point decimal maths (BigInt, scale 8)
src/lib/auth.ts             Sessions, password hashing, authorization, origin checks
src/lib/workspace.ts        Idempotent business/currency/account seeding
src/lib/validation.ts       Zod contracts shared by forms, API and assistant tools
src/lib/finance.ts          Draft normalization, inventory snapshots
src/lib/posting.ts          Balanced journal construction, approval, reversal, impact
src/lib/overview.ts         Dashboards, P&L, cash-flow, statements, audit queries
src/lib/assistant.ts        Modular AI provider adapter + local rules fallback
src/app/api/action/route.ts REST-style dispatcher (route=…&businessId=…)
src/components/             Mobile-first UI shell, screens, forms, receipts
public/branding/            Original SVG logo system
tests/                      Automated financial tests
```

---

## 6. Deliberate limitations

- No live exchange-rate feed: rates are owner-entered and timestamped with a source label.
- No file/document upload storage is configured; logo URL must be a local asset or HTTPS URL.
- Email invitations and password reset require an unconfigured mail provider.
- Opening balances are entered as income/expense or purchase drafts; there is no
  dedicated opening-balance screen yet.
