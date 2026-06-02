CREATE TABLE "identity_mapping" (
	"id" serial PRIMARY KEY NOT NULL,
	"nbid" text NOT NULL,
	"cifhash" text NOT NULL,
	"cif" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_mapping_nbid_unique" UNIQUE("nbid"),
	CONSTRAINT "identity_mapping_cifhash_unique" UNIQUE("cifhash"),
	CONSTRAINT "identity_mapping_cif_unique" UNIQUE("cif")
);
--> statement-breakpoint
CREATE TABLE "profile_segments" (
	"profile_id" integer NOT NULL,
	"segment_id" integer NOT NULL,
	"status" text NOT NULL,
	"last_qualification_time" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_segments_profile_id_segment_id_pk" PRIMARY KEY("profile_id","segment_id")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"nbid" text,
	"cifhash" text,
	"cif" text,
	"web_tracker_id" text,
	"ecids" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_authenticated" boolean DEFAULT false NOT NULL,
	"raw_identities" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"profiles_count" integer DEFAULT 0 NOT NULL,
	"ld_forwarded" boolean DEFAULT false NOT NULL,
	"source_ip" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"segment_id" text NOT NULL,
	"segment_name" text,
	"ld_segment_key" text,
	"ld_synced" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"profile_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "segments_segment_id_unique" UNIQUE("segment_id")
);
--> statement-breakpoint
ALTER TABLE "profile_segments" ADD CONSTRAINT "profile_segments_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_segments" ADD CONSTRAINT "profile_segments_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_nbid_idx" ON "profiles" USING btree ("nbid") WHERE nbid IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_cifhash_idx" ON "profiles" USING btree ("cifhash") WHERE cifhash IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_cif_idx" ON "profiles" USING btree ("cif") WHERE cif IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_web_tracker_id_idx" ON "profiles" USING btree ("web_tracker_id") WHERE web_tracker_id IS NOT NULL;