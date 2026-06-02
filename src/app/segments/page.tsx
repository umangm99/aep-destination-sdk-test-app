import Link from "next/link";
import { db } from "@/db";
import { segments } from "@/db/schema";
import { desc, count } from "drizzle-orm";
import "../profiles/profiles.css"; // Reuse table styles

export const dynamic = "force-dynamic";

export default async function SegmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const resolvedParams = await searchParams;
  const page = Math.max(1, Number.parseInt(resolvedParams.page || "1", 10));
  const limit = 20;
  const offset = (page - 1) * limit;

  const database = db();
  
  const [segmentList, [totalResult]] = await Promise.all([
    database
      .select()
      .from(segments)
      .orderBy(desc(segments.profileCount))
      .limit(limit)
      .offset(offset),
    database.select({ total: count() }).from(segments),
  ]);

  const total = totalResult.total;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Audiences & Segments</h1>
          <p className="page-subtitle">AEP segments mapped to this destination</p>
        </div>
      </header>

      <div className="glass-panel main-panel">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Segment ID</th>
                <th>Name</th>
                <th>LD Key</th>
                <th>Active Profiles</th>
                <th>First Seen</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {segmentList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">No segments found</td>
                </tr>
              ) : (
                segmentList.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{s.segmentId}</td>
                    <td>{s.segmentName || '-'}</td>
                    <td>
                      {s.ldSegmentKey ? (
                        <span style={{ padding: '2px 8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '0.8rem' }}>
                          {s.ldSegmentKey}
                        </span>
                      ) : '-'}
                    </td>
                    <td><strong>{s.profileCount}</strong></td>
                    <td>{new Date(s.firstSeenAt).toLocaleDateString()}</td>
                    <td>
                      <Link href={`/segments/${s.id}`} className="action-btn">
                        View Members
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="pagination">
            {page > 1 && <Link href={`/segments?page=${page - 1}`} className="page-btn">Previous</Link>}
            <span className="page-info">Page {page} of {totalPages}</span>
            {page < totalPages && <Link href={`/segments?page=${page + 1}`} className="page-btn">Next</Link>}
          </div>
        )}
      </div>
    </div>
  );
}
