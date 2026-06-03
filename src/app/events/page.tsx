"use client";

import { useEffect, useState } from "react";
import "../profiles/profiles.css"; // Reuse table styling

interface EventFeedItem {
  id: number;
  profilesCount: number;
  ldForwarded: boolean;
  receivedAt: string;
  sourceIp: string | null;
  payload: any;
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPayload, setSelectedPayload] = useState<any>(null);

  const fetchEvents = async () => {
    try {
      const res = await fetch("/api/events?limit=50");
      const data = await res.json();
      setEvents(data.events || []);
    } catch (err) {
      console.error("Failed to fetch events", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="page-container animate-fade-in" style={{ display: 'flex', gap: '32px' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <header className="page-header" style={{ paddingBottom: '16px' }}>
          <div>
            <h1 className="page-title">Recent Events (Last 15 Mins)</h1>
            <p className="page-subtitle">Raw webhook payloads received from AEP in the last 15 minutes</p>
          </div>
        </header>

        <div className="glass-panel main-panel">
          <div className="table-wrapper" style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
            <table className="data-table">
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-dark)', zIndex: 10 }}>
                <tr>
                  <th>Time</th>
                  <th>Profiles</th>
                  <th>LD Sync</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && events.length === 0 ? (
                  <tr><td colSpan={4} className="empty-state">Loading events...</td></tr>
                ) : events.length === 0 ? (
                  <tr><td colSpan={4} className="empty-state">Waiting for AEP events...</td></tr>
                ) : (
                  events.map((e) => (
                    <tr key={e.id} 
                        style={{ cursor: 'pointer', background: selectedPayload === e.payload ? 'rgba(255,255,255,0.05)' : 'transparent' }}
                        onClick={() => setSelectedPayload(e.payload)}>
                      <td style={{ whiteSpace: 'nowrap' }}>{new Date(e.receivedAt).toLocaleTimeString()}</td>
                      <td><strong>{e.profilesCount}</strong></td>
                      <td>
                        <div className={`badge-dot ${e.ldForwarded ? 'realized' : 'exited'}`} 
                             style={{ backgroundColor: e.ldForwarded ? 'var(--status-realized)' : 'var(--status-exited)', display: 'inline-block', marginRight: '8px' }}></div>
                      </td>
                      <td>
                        <button className="action-btn" onClick={(ev) => { ev.stopPropagation(); setSelectedPayload(e.payload); }}>
                          Inspect
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* JSON Viewer Sidebar */}
      <div className="glass-panel main-panel" style={{ width: '450px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)', position: 'sticky', top: '40px' }}>
        <div className="panel-header" style={{ marginBottom: '16px', borderBottom: '1px solid var(--border-light)', paddingBottom: '16px' }}>
          <h3 style={{ fontSize: '1.1rem' }}>Payload Inspector</h3>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '16px' }}>
          {selectedPayload ? (
            <pre style={{ 
              fontSize: '0.8rem', 
              color: 'var(--text-secondary)', 
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}>
              {JSON.stringify(selectedPayload, null, 2)}
            </pre>
          ) : (
            <div className="empty-state" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              Select an event to view its raw JSON payload
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
