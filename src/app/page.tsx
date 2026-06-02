"use client";

import { useEffect, useState } from "react";
import { StatsCard } from "./components/UIComponents";
import "./dashboard.css";

interface DashboardStats {
  totalEvents: number;
  totalProfiles: number;
  totalSegments: number;
  eventsLastHour: number;
  ldForwardedEvents: number;
  ldEnabled: boolean;
  authenticatedProfiles: number;
  unauthenticatedProfiles: number;
  realizedMemberships: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/stats");
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error("Failed to fetch stats", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    // Poll every 5 seconds
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !stats) {
    return <div className="loading-state">Loading dashboard...</div>;
  }

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Realtime Dashboard</h1>
          <p className="page-subtitle">AEP Destination Events & Profiles</p>
        </div>
        <div className="header-actions">
          <div className={`status-pill ${stats?.ldEnabled ? 'active' : 'inactive'}`}>
            LaunchDarkly Sync: {stats?.ldEnabled ? 'ON' : 'OFF'}
          </div>
        </div>
      </header>

      <div className="stats-grid">
        <StatsCard 
          title="Total Events" 
          value={(stats?.totalEvents || 0).toLocaleString()} 
          subtitle={`${stats?.eventsLastHour || 0} in the last hour`}
          icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>}
        />
        <StatsCard 
          title="Total Profiles" 
          value={(stats?.totalProfiles || 0).toLocaleString()} 
          subtitle={`${stats?.authenticatedProfiles || 0} authenticated`}
          icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>}
        />
        <StatsCard 
          title="Audiences / Segments" 
          value={(stats?.totalSegments || 0).toLocaleString()} 
          subtitle={`${stats?.realizedMemberships || 0} active qualifications`}
          icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg>}
        />
        <StatsCard 
          title="LaunchDarkly Syncs" 
          value={(stats?.ldForwardedEvents || 0).toLocaleString()} 
          subtitle="Events successfully forwarded"
          icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>}
        />
      </div>

      <div className="dashboard-content">
        <div className="glass-panel main-panel">
          <div className="panel-header">
            <h3>System Architecture</h3>
          </div>
          <div className="panel-body arch-diagram">
            <div className="node aep">Adobe Experience Platform</div>
            <div className="edge" />
            <div className="node api">
              Next.js API
              <span className="subtext">Basic Auth</span>
            </div>
            <div className="split">
              <div className="branch">
                <div className="edge vertical" />
                <div className="node db">Neon Postgres</div>
              </div>
              <div className="branch">
                <div className="edge vertical" />
                <div className="node worker">
                  Background Task
                  <span className="subtext">next/server after()</span>
                </div>
                <div className="edge vertical" />
                <div className="node ld">LaunchDarkly REST API</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
