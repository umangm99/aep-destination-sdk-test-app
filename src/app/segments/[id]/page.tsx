import Link from "next/link";
import { AuthBadge, IdentityTag, SegmentBadge } from "../../components/UIComponents";
import "../../profiles/profiles.css";
import { db } from "@/db";
import { profiles, profileSegments, segments } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SegmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const segmentDbId = Number.parseInt(id, 10);
  
  if (Number.isNaN(segmentDbId)) notFound();

  const database = db();

  const [segment] = await database
    .select()
    .from(segments)
    .where(eq(segments.id, segmentDbId))
    .limit(1);

  if (!segment) notFound();

  const members = await database
    .select({
      profileId: profiles.id,
      nbid: profiles.nbid,
      cifhash: profiles.cifhash,
      webTrackerId: profiles.webTrackerId,
      ecid: profiles.ecid,
      isAuthenticated: profiles.isAuthenticated,
      status: profileSegments.status,
      lastQualificationTime: profileSegments.lastQualificationTime,
    })
    .from(profileSegments)
    .innerJoin(profiles, eq(profileSegments.profileId, profiles.id))
    .where(eq(profileSegments.segmentId, segmentDbId))
    .orderBy(desc(profileSegments.updatedAt))
    .limit(100); // For demo purposes, limit to 100 recent members

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <Link href="/segments" style={{ color: 'var(--text-muted)' }}>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            </Link>
            <h1 className="page-title" style={{ margin: 0 }}>{segment.segmentName || segment.segmentId}</h1>
          </div>
          <p className="page-subtitle">Segment ID: {segment.segmentId}</p>
        </div>
      </header>

      <div className="stats-grid">
        <div className="glass-panel main-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Total Active Profiles</h3>
          <div style={{ fontSize: '2rem', fontWeight: 700 }}>{segment.profileCount}</div>
        </div>
        <div className="glass-panel main-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>LaunchDarkly Sync</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className={`badge-dot ${segment.ldSynced ? 'realized' : 'exited'}`} style={{ backgroundColor: segment.ldSynced ? 'var(--status-realized)' : 'var(--status-exited)' }}></div>
            <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>
              {segment.ldSynced ? 'Synced' : 'Not Synced'}
            </div>
          </div>
          {segment.ldSegmentKey && (
            <div style={{ marginTop: '12px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Key: <code style={{ color: 'var(--text-primary)' }}>{segment.ldSegmentKey}</code>
            </div>
          )}
        </div>
        <div className="glass-panel main-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>First Seen</h3>
          <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>{new Date(segment.firstSeenAt).toLocaleDateString()}</div>
        </div>
      </div>

      <div className="glass-panel main-panel">
        <div className="panel-header" style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '1.2rem' }}>Recent Members</h3>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Identity</th>
                <th>Auth State</th>
                <th>Qualified At</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr><td colSpan={5} className="empty-state">No members found</td></tr>
              ) : (
                members.map((m, i) => (
                  <tr key={i}>
                    <td><SegmentBadge status={m.status} name={m.status} /></td>
                    <td>
                      {m.nbid ? (
                        <IdentityTag label="NBID" value={m.nbid} />
                      ) : m.webTrackerId ? (
                        <IdentityTag label="WTID" value={m.webTrackerId} />
                      ) : (
                        <IdentityTag label="ECID" value={m.ecid} />
                      )}
                    </td>
                    <td><AuthBadge isAuthenticated={m.isAuthenticated} /></td>
                    <td>{m.lastQualificationTime ? new Date(m.lastQualificationTime).toLocaleString() : '-'}</td>
                    <td>
                      <Link href={`/profiles/${m.profileId}`} className="action-btn">
                        View Profile
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
