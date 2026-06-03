import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Raw Events ──────────────────────────────────────────────────────────────
// Immutable audit log of every AEP payload received
export const rawEvents = pgTable("raw_events", {
  id: serial("id").primaryKey(),
  payload: jsonb("payload").notNull(),
  profilesCount: integer("profiles_count").notNull().default(0),
  ldForwarded: boolean("ld_forwarded").notNull().default(false),
  sourceIp: text("source_ip"),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

import { sql } from "drizzle-orm";

// ─── Profiles ────────────────────────────────────────────────────────────────
// One row per unique profile, keyed by identities
export const profiles = pgTable("profiles", {
  id: serial("id").primaryKey(),
  // Authenticated identities (unique per customer, 1:1 mapped)
  nbid: text("nbid"),
  cifhash: text("cifhash"),
  cif: text("cif"),
  // Tracking identities
  webTrackerId: text("web_tracker_id"),
  isAuthenticated: boolean("is_authenticated").notNull().default(false),
  // Raw identities as received from AEP (for debugging)
  rawIdentities: jsonb("raw_identities"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("profiles_nbid_idx").on(table.nbid).where(sql`nbid IS NOT NULL`),
  uniqueIndex("profiles_cifhash_idx").on(table.cifhash).where(sql`cifhash IS NOT NULL`),
  uniqueIndex("profiles_cif_idx").on(table.cif).where(sql`cif IS NOT NULL`),
  uniqueIndex("profiles_web_tracker_id_idx").on(table.webTrackerId).where(sql`web_tracker_id IS NOT NULL`),
]);

// ─── Identity Mapping ────────────────────────────────────────────────────────
// 1:1 mapping between authenticated identifiers (cifhash → nbid → cif)
export const identityMapping = pgTable("identity_mapping", {
  id: serial("id").primaryKey(),
  nbid: text("nbid").notNull().unique(),
  cifhash: text("cifhash").notNull().unique(),
  cif: text("cif").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Segments ────────────────────────────────────────────────────────────────
// Every AEP segment/audience seen
export const segments = pgTable("segments", {
  id: serial("id").primaryKey(),
  segmentId: text("segment_id").notNull().unique(),
  segmentName: text("segment_name"),
  ldSegmentKey: text("ld_segment_key"),
  ldSynced: boolean("ld_synced").notNull().default(false),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  profileCount: integer("profile_count").notNull().default(0),
});

// ─── Profile Segments ────────────────────────────────────────────────────────
// Many-to-many: which profiles are in which segments
export const profileSegments = pgTable(
  "profile_segments",
  {
    profileId: integer("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    segmentId: integer("segment_id")
      .notNull()
      .references(() => segments.id, { onDelete: "cascade" }),
    status: text("status").notNull(), // "realized", "existing", "exited"
    lastQualificationTime: text("last_qualification_time"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.segmentId] }),
  ],
);

// ─── Type Exports ────────────────────────────────────────────────────────────
export type RawEvent = typeof rawEvents.$inferSelect;
export type NewRawEvent = typeof rawEvents.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type IdentityMap = typeof identityMapping.$inferSelect;
export type Segment = typeof segments.$inferSelect;
export type ProfileSegment = typeof profileSegments.$inferSelect;
