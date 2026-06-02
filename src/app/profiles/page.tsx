import Link from "next/link";
import { AuthBadge, IdentityTag } from "../components/UIComponents";
import "./profiles.css";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { desc, count, or, ilike, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function ProfilesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string }>;
}) {
  const resolvedParams = await searchParams;
  const page = Math.max(1, Number.parseInt(resolvedParams.page || "1", 10));
  const limit = 20;
  const offset = (page - 1) * limit;
  const search = resolvedParams.search?.trim();

  const database = db();
  
  const whereClause = search
    ? or(
        ilike(profiles.nbid, `%${search}%`),
        ilike(profiles.cifhash, `%${search}%`),
        ilike(profiles.cif, `%${search}%`),
        ilike(profiles.webTrackerId, `%${search}%`),
        ilike(sql`array_to_string(${profiles.ecids}, ',')`, `%${search}%`),
      )
    : undefined;

  const [profileList, [totalResult]] = await Promise.all([
    database
      .select({
        id: profiles.id,
        nbid: profiles.nbid,
        cifhash: profiles.cifhash,
        cif: profiles.cif,
        webTrackerId: profiles.webTrackerId,
        ecids: profiles.ecids,
        isAuthenticated: profiles.isAuthenticated,
        lastSeenAt: profiles.lastSeenAt,
        segmentCount: sql<number>`(
          SELECT COUNT(*) FROM profile_segments ps
          WHERE ps.profile_id = ${profiles.id}
          AND ps.status IN ('realized', 'existing')
        )`.as("segment_count"),
      })
      .from(profiles)
      .where(whereClause)
      .orderBy(desc(profiles.lastSeenAt))
      .limit(limit)
      .offset(offset),
    database
      .select({ total: count() })
      .from(profiles)
      .where(whereClause),
  ]);

  const total = totalResult.total;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Profiles</h1>
          <p className="page-subtitle">Manage and search customer profiles</p>
        </div>
      </header>

      <div className="glass-panel main-panel">
        <form className="search-bar" action="/profiles" method="GET">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input 
            type="text" 
            name="search" 
            placeholder="Search by NBID, CIFHash, ECID..." 
            defaultValue={search}
          />
          <button type="submit">Search</button>
        </form>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Primary Identity</th>
                <th>Other Identities</th>
                <th>Active Segments</th>
                <th>Last Seen</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {profileList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">No profiles found</td>
                </tr>
              ) : (
                profileList.map((p) => (
                  <tr key={p.id}>
                    <td><AuthBadge isAuthenticated={p.isAuthenticated} /></td>
                    <td>
                      {p.nbid ? (
                        <IdentityTag label="NBID" value={p.nbid} />
                      ) : p.webTrackerId ? (
                        <IdentityTag label="WTID" value={p.webTrackerId} />
                      ) : p.ecids.length > 0 ? (
                        <IdentityTag label="ECID" value={p.ecids[0]} />
                      ) : null}
                    </td>
                    <td>
                      <div className="id-tags-inline">
                        {p.nbid && <IdentityTag label="CIFHash" value={p.cifhash} />}
                        {p.nbid && <IdentityTag label="CIF" value={p.cif} />}
                        {(p.nbid || p.webTrackerId) 
                          ? p.ecids.map((ecid, i) => <IdentityTag key={i} label="ECID" value={ecid} />)
                          : p.ecids.slice(1).map((ecid, i) => <IdentityTag key={i} label="ECID" value={ecid} />)
                        }
                      </div>
                    </td>
                    <td>{p.segmentCount}</td>
                    <td>{new Date(p.lastSeenAt).toLocaleString()}</td>
                    <td>
                      <Link href={`/profiles/${p.id}`} className="action-btn">
                        View Details
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
            {page > 1 && (
              <Link href={`/profiles?page=${page - 1}${search ? `&search=${search}` : ''}`} className="page-btn">
                Previous
              </Link>
            )}
            <span className="page-info">Page {page} of {totalPages}</span>
            {page < totalPages && (
              <Link href={`/profiles?page=${page + 1}${search ? `&search=${search}` : ''}`} className="page-btn">
                Next
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
