import Link from "next/link";
import { AuthBadge, IdentityTag, SegmentBadge } from "../../components/UIComponents";
import "../profiles.css";
import { db } from "@/db";
import { profiles, profileSegments, segments, identityMapping } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProfileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profileId = Number.parseInt(id, 10);
  
  if (Number.isNaN(profileId)) notFound();

  const database = db();

  const [profile] = await database
    .select()
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);

  if (!profile) notFound();

  const memberships = await database
    .select({
      segmentId: segments.segmentId,
      segmentName: segments.segmentName,
      status: profileSegments.status,
      lastQualificationTime: profileSegments.lastQualificationTime,
      updatedAt: profileSegments.updatedAt,
      ldSynced: segments.ldSynced,
    })
    .from(profileSegments)
    .innerJoin(segments, eq(profileSegments.segmentId, segments.id))
    .where(eq(profileSegments.profileId, profileId));

  let mapping = null;
  if (profile.cifhash) {
    const [m] = await database
      .select()
      .from(identityMapping)
      .where(eq(identityMapping.cifhash, profile.cifhash))
      .limit(1);
    mapping = m || null;
  }

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <Link href="/profiles" style={{ color: 'var(--text-muted)' }}>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            </Link>
            <h1 className="page-title" style={{ margin: 0 }}>Profile Details</h1>
          </div>
          <p className="page-subtitle">ID: {profile.id}</p>
        </div>
        <AuthBadge isAuthenticated={profile.isAuthenticated} />
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        <div className="glass-panel main-panel" style={{ padding: '24px' }}>
          <h3 style={{ marginBottom: '20px', fontSize: '1.1rem' }}>Identities</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {profile.nbid && <IdentityTag label="NBID (Primary)" value={profile.nbid} />}
            {profile.cifhash && <IdentityTag label="CIFHash" value={profile.cifhash} />}
            {profile.cif && <IdentityTag label="CIF" value={profile.cif} />}
            {profile.webTrackerId && <IdentityTag label="WebTrackerID" value={profile.webTrackerId} />}
            {profile.ecid && <IdentityTag label="ECID" value={profile.ecid} />}
          </div>
        </div>

        <div className="glass-panel main-panel" style={{ padding: '24px' }}>
          <h3 style={{ marginBottom: '20px', fontSize: '1.1rem' }}>Metadata</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>First Seen</div>
              <div>{new Date(profile.firstSeenAt).toLocaleString()}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Last Seen</div>
              <div>{new Date(profile.lastSeenAt).toLocaleString()}</div>
            </div>
            {mapping && (
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Identity Graph Edge</div>
                <div style={{ fontSize: '0.9rem', color: 'var(--accent-primary)' }}>
                  Linked via mapping table (ID: {mapping.id})
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="glass-panel main-panel">
        <div className="panel-header" style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '1.2rem' }}>Segment Memberships ({memberships.length})</h3>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Segment ID</th>
                <th>Name</th>
                <th>Last Qualification</th>
                <th>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {memberships.length === 0 ? (
                <tr><td colSpan={5} className="empty-state">No segment memberships</td></tr>
              ) : (
                memberships.map((m, i) => (
                  <tr key={i}>
                    <td><SegmentBadge status={m.status} name={m.status} /></td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{m.segmentId}</td>
                    <td>{m.segmentName || '-'}</td>
                    <td>{m.lastQualificationTime ? new Date(m.lastQualificationTime).toLocaleString() : '-'}</td>
                    <td>{new Date(m.updatedAt).toLocaleString()}</td>
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
