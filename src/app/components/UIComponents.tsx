import "./ui-components.css";

export function StatsCard({ 
  title, 
  value, 
  subtitle,
  icon
}: { 
  title: string; 
  value: string | number; 
  subtitle?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="glass-panel stat-card animate-fade-in">
      <div className="stat-header">
        <h3 className="stat-title">{title}</h3>
        {icon && <div className="stat-icon">{icon}</div>}
      </div>
      <div className="stat-value">{value}</div>
      {subtitle && <div className="stat-subtitle">{subtitle}</div>}
    </div>
  );
}

export function SegmentBadge({ status, name }: { status: string; name: string }) {
  const isRealized = status === "realized" || status === "existing";
  return (
    <span className={`segment-badge ${isRealized ? "realized" : "exited"}`}>
      <span className="badge-dot"></span>
      {name}
    </span>
  );
}

export function AuthBadge({ isAuthenticated }: { isAuthenticated: boolean }) {
  if (isAuthenticated) {
    return <span className="auth-badge authed">Authenticated</span>;
  }
  return <span className="auth-badge anon">Anonymous</span>;
}

export function IdentityTag({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="identity-tag">
      <span className="id-label">{label}</span>
      <span className="id-value" title={value}>{value}</span>
    </div>
  );
}
