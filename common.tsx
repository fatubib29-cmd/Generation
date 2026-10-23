import type { CSSProperties, MouseEvent, ReactNode } from "react";

export type IconName =
  | "home" | "sparkles" | "exchange" | "coins" | "receipt" | "users" | "plane" | "chart" | "bank"
  | "settings" | "bell" | "menu" | "search" | "plus" | "logout" | "chevron" | "close" | "mic" | "send"
  | "download" | "share" | "print" | "user" | "wallet" | "calendar" | "check" | "x" | "file" | "globe"
  | "shield" | "clock" | "arrow" | "filter" | "more" | "briefcase" | "compass" | "building" | "star"
  | "refresh" | "copy" | "map" | "clipboard" | "lock" | "eye" | "warning" | "cash" | "message" | "edit"
  | "link" | "trend" | "arrowDown" | "arrowUp" | "circleCheck" | "folder" | "receiptCheck";

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  let shape: ReactNode;
  switch (name) {
    case "home": shape = <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-6h6v6"/></>; break;
    case "sparkles": shape = <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14ZM5 14l.7 1.8L7.5 16.5l-1.8.7L5 19l-.7-1.8-1.8-.7 1.8-.7L5 14Z"/></>; break;
    case "exchange": shape = <><path d="M4 7h15l-3-3"/><path d="m19 7-3 3M20 17H5l3 3"/><path d="m5 17 3-3"/></>; break;
    case "coins": shape = <><circle cx="8" cy="8" r="5"/><path d="M16 10a5 5 0 1 1-5 6M8 5v6M6 7h4"/><path d="M15 13v6M13.5 15h3"/></>; break;
    case "receipt": shape = <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z"/><path d="M8 8h8M8 12h8M8 16h4"/></>; break;
    case "users": shape = <><circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1"/><path d="M16 5.5a3 3 0 0 1 0 5.8M18 14a5 5 0 0 1 3 4.5V20"/></>; break;
    case "plane": shape = <><path d="m21 3-7.1 18-3.4-7.5L3 10.1 21 3Z"/><path d="m10.5 13.5 4.2-4.2"/></>; break;
    case "chart": shape = <><path d="M4 19V5M4 19h17"/><path d="m7 15 4-4 3 2 6-7"/><path d="M17 6h3v3"/></>; break;
    case "bank": shape = <><path d="m3 9 9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M3 18h18"/></>; break;
    case "settings": shape = <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.2 1-1.7 3-1.5-.7-.2.1-1.3.8-.1 1.7h-3.5l-.1-1.7-1.3-.8-1.7.6-1.7-3 1.2-1 .1-.2-.1-1.5-1.2-1 1.7-3 1.7.6 1.3-.8.1-1.7h3.5l.1 1.7 1.3.8 1.5-.6 1.7 3-1.2 1-.1.2.1 1.4Z"/></>; break;
    case "bell": shape = <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>; break;
    case "menu": shape = <><path d="M4 6h16M4 12h16M4 18h16"/></>; break;
    case "search": shape = <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></>; break;
    case "plus": shape = <><path d="M12 5v14M5 12h14"/></>; break;
    case "logout": shape = <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/></>; break;
    case "chevron": shape = <><path d="m6 9 6 6 6-6"/></>; break;
    case "close": shape = <><path d="m6 6 12 12M18 6 6 18"/></>; break;
    case "mic": shape = <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></>; break;
    case "send": shape = <><path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/></>; break;
    case "download": shape = <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 20h16"/></>; break;
    case "share": shape = <><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.7 6.6-4.4M8.7 13.3l6.6 4.4"/></>; break;
    case "print": shape = <><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7zM17 11h1"/></>; break;
    case "user": shape = <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>; break;
    case "wallet": shape = <><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20v16H6a3 3 0 0 1-3-3V6.5Z"/><path d="M3 7h17M15 13h5M16.5 13v.1"/></>; break;
    case "calendar": shape = <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>; break;
    case "check": shape = <><path d="m5 12 4 4L19 6"/></>; break;
    case "x": shape = <><path d="m6 6 12 12M18 6 6 18"/></>; break;
    case "file": shape = <><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v6h5M9 13h7M9 17h7"/></>; break;
    case "globe": shape = <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>; break;
    case "shield": shape = <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>; break;
    case "clock": shape = <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>; break;
    case "arrow": shape = <><path d="M5 12h14M13 6l6 6-6 6"/></>; break;
    case "filter": shape = <><path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z"/></>; break;
    case "more": shape = <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>; break;
    case "briefcase": shape = <><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 12h18M10 12v2h4v-2"/></>; break;
    case "compass": shape = <><circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z"/></>; break;
    case "building": shape = <><path d="M4 21V5l8-3 8 3v16M2 21h20M8 8h2M14 8h2M8 12h2M14 12h2M10 21v-5h4v5"/></>; break;
    case "star": shape = <><path d="m12 3 2.7 5.6 6.2.9-4.5 4.4 1.1 6.2-5.5-2.9-5.5 2.9 1.1-6.2-4.5-4.4 6.2-.9L12 3Z"/></>; break;
    case "refresh": shape = <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.8-2L20 12M4 12l2.6 5a7 7 0 0 0 11.8-2"/></>; break;
    case "copy": shape = <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/></>; break;
    case "map": shape = <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/></>; break;
    case "clipboard": shape = <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M8 10h8M8 14h8M8 18h4"/></>; break;
    case "lock": shape = <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>; break;
    case "eye": shape = <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>; break;
    case "warning": shape = <><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 17h.01"/></>; break;
    case "cash": shape = <><rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9h.01M18 15h.01"/></>; break;
    case "message": shape = <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 4a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.4Z"/></>; break;
    case "edit": shape = <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></>; break;
    case "link": shape = <><path d="M10 13a5 5 0 0 0 7.5.5l3-3A5 5 0 0 0 13.5 3L12 4.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3A5 5 0 0 0 10.5 21L12 19.5"/></>; break;
    case "trend": shape = <><path d="m4 16 5-5 4 3 7-8"/><path d="M14 6h6v6"/></>; break;
    case "arrowDown": shape = <><path d="M12 4v16M6 14l6 6 6-6"/></>; break;
    case "arrowUp": shape = <><path d="M12 20V4M6 10l6-6 6 6"/></>; break;
    case "circleCheck": shape = <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>; break;
    case "folder": shape = <><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z"/><path d="M3 9h18"/></>; break;
    case "receiptCheck": shape = <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z"/><path d="m8 12 2 2 5-5"/></>; break;
    default: shape = <circle cx="12" cy="12" r="8"/>;
  }
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shape}</svg>;
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const stop = (event: MouseEvent<HTMLDivElement>) => event.stopPropagation();
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={stop}>
        <div className="modal-header">
          <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function SectionHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="panel-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return <span className={`status-pill ${status.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`}>{label ?? status.replaceAll("_", " ")}</span>;
}

export function EmptyState({ icon = "folder", title, description, action }: { icon?: IconName; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-state-icon"><Icon name={icon} size={20} /></div><h3>{title}</h3><p>{description}</p>{action && <div style={{ marginTop: 15 }}>{action}</div>}</div>;
}

export function formatMoney(value: string | number | null | undefined, currency: string): string {
  const amount = value == null || value === "" ? "0" : String(value);
  return `${amount} ${currency}`;
}

export function initials(value: string): string {
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "BL";
}

export function BrandMark({ src, alt, size = 40, className }: { src: string; alt: string; size?: number; className?: string }) {
  return <img className={className} src={src} alt={alt} style={{ width: size, height: "auto", objectFit: "contain" } as CSSProperties} />;
}
