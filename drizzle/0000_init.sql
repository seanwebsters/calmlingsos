CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"production_id" text,
	"step_id" text,
	"agent_key" text NOT NULL,
	"task" text NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"references_used" jsonb DEFAULT '{"assetVersionIds":[],"characterVersionIds":[],"canonRecordIds":[],"decisionIds":[]}'::jsonb NOT NULL,
	"output" jsonb,
	"status" text NOT NULL,
	"provider" text,
	"model" text,
	"prompt_version" text,
	"cost_cents" double precision DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"key" text NOT NULL,
	"instructions" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"budget_cents_per_run" integer NOT NULL,
	"quality_preference" text DEFAULT 'balanced' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_records" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"source" text NOT NULL,
	"import_batch" text NOT NULL,
	"platform" text NOT NULL,
	"post_id" text NOT NULL,
	"posted_at" timestamp with time zone,
	"title" text DEFAULT '' NOT NULL,
	"character_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"format" text,
	"theme" text,
	"views" integer,
	"watch_time_seconds" double precision,
	"avg_retention_pct" real,
	"shares" integer,
	"saves" integer,
	"likes" integer,
	"comments" integer,
	"follower_delta" integer,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_characters" (
	"asset_id" text NOT NULL,
	"character_id" text NOT NULL,
	CONSTRAINT "asset_characters_asset_id_character_id_pk" PRIMARY KEY("asset_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "asset_projects" (
	"asset_id" text NOT NULL,
	"project_id" text NOT NULL,
	CONSTRAINT "asset_projects_asset_id_project_id_pk" PRIMARY KEY("asset_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "asset_tags" (
	"asset_id" text NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "asset_tags_asset_id_tag_pk" PRIMARY KEY("asset_id","tag")
);
--> statement-breakpoint
CREATE TABLE "asset_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"thumbnail_key" text,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"actor_user_id" text,
	"actor_agent" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"production_id" text,
	"platform" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"production_id" text,
	"name" text NOT NULL,
	"objective" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"starts_on" timestamp with time zone,
	"ends_on" timestamp with time zone,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canon_records" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"lineage_id" text NOT NULL,
	"previous_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"domain" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"canon_status" text DEFAULT 'draft' NOT NULL,
	"superseded" boolean DEFAULT false NOT NULL,
	"character_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timeline_order" integer,
	"created_by" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"character_id" text NOT NULL,
	"version" integer NOT NULL,
	"profile" jsonb NOT NULL,
	"status" text NOT NULL,
	"source" text DEFAULT 'human' NOT NULL,
	"change_note" text DEFAULT '' NOT NULL,
	"created_by" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"canon_status" text DEFAULT 'draft' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"locked_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_version_id" text,
	"hero_asset_id" text,
	"summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"body" text NOT NULL,
	"annotation" jsonb,
	"author_id" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_records" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"production_id" text,
	"step_id" text,
	"run_id" text,
	"provider" text NOT NULL,
	"model" text,
	"capability" text NOT NULL,
	"units" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_cents" double precision NOT NULL,
	"estimated" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creative_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"department" text,
	"character_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_type" text,
	"source_id" text,
	"is_rule" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"text" text NOT NULL,
	"vector" real[] NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"production_id" text,
	"name" text NOT NULL,
	"collection" text DEFAULT 'Unsorted' NOT NULL,
	"spec" jsonb NOT NULL,
	"status" text DEFAULT 'concept' NOT NULL,
	"source_generated_asset_id" text,
	"source_reference_version_id" text,
	"storage_key" text,
	"validation" jsonb,
	"character_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"production_id" text,
	"step_id" text,
	"item_key" text,
	"kind" text NOT NULL,
	"role" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'ready_for_review' NOT NULL,
	"storage_key" text,
	"thumbnail_key" text,
	"mime_type" text,
	"size_bytes" integer,
	"width" integer,
	"height" integer,
	"duration_seconds" real,
	"text_content" text,
	"lineage_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_id" text,
	"locked" boolean DEFAULT false NOT NULL,
	"character_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"cost_cents" double precision DEFAULT 0 NOT NULL,
	"consistency_score" real,
	"consistency_report" jsonb,
	"promoted_reference_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "product_concepts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"production_id" text,
	"lineage_id" text NOT NULL,
	"iteration" integer DEFAULT 1 NOT NULL,
	"range_name" text,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"character_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"materials" text DEFAULT '' NOT NULL,
	"dimensions" text DEFAULT '' NOT NULL,
	"packaging" text DEFAULT '' NOT NULL,
	"target_audience" text DEFAULT '' NOT NULL,
	"target_retail_cents" integer,
	"est_unit_cost_cents" integer,
	"moq_assumption" integer,
	"margin_scenarios" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"feasibility_risks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"licensing_opportunities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quote_verified" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"production_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"agent_key" text,
	"handler" text NOT NULL,
	"depends_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"condition" jsonb,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"output" jsonb,
	"revision_notes" text,
	"error" text,
	"blocked_on" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"queue_seq" integer DEFAULT 0 NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"budget_estimate_cents" double precision DEFAULT 0 NOT NULL,
	"actual_cost_cents" double precision DEFAULT 0 NOT NULL,
	"provider_override" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "productions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text,
	"department" text NOT NULL,
	"title" text NOT NULL,
	"template_key" text NOT NULL,
	"template_version" integer DEFAULT 1 NOT NULL,
	"brief" jsonb NOT NULL,
	"character_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"budget_cents" integer NOT NULL,
	"spent_cents" double precision DEFAULT 0 NOT NULL,
	"provider_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"context_snapshot" jsonb,
	"command" text,
	"due_date" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"department" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"provider_key" text NOT NULL,
	"ciphertext" text NOT NULL,
	"hint" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"provider_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"allow_proprietary_references" boolean DEFAULT false NOT NULL,
	"models" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"title" text NOT NULL,
	"asset_type" text NOT NULL,
	"media_kind" text NOT NULL,
	"designation" text DEFAULT 'unclassified' NOT NULL,
	"approval_state" text DEFAULT 'pending' NOT NULL,
	"view_angle" text,
	"source" text DEFAULT 'upload' NOT NULL,
	"rights_status" text DEFAULT 'unknown' NOT NULL,
	"usage_notes" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"current_version_id" text,
	"analysis_status" text DEFAULT 'none' NOT NULL,
	"analysis_error" text,
	"analysis" jsonb,
	"analysis_reviewed" boolean DEFAULT false NOT NULL,
	"technical" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"collection_id" text,
	"promoted_from_id" text,
	"immutable" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"comment" text DEFAULT '' NOT NULL,
	"reviewer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "shots" (
	"id" text PRIMARY KEY NOT NULL,
	"storyboard_id" text NOT NULL,
	"social_video_id" text NOT NULL,
	"index" integer NOT NULL,
	"description" text NOT NULL,
	"camera" text DEFAULT '' NOT NULL,
	"action" text DEFAULT '' NOT NULL,
	"dialogue" text DEFAULT '' NOT NULL,
	"speaker_character_id" text,
	"sound" text DEFAULT '' NOT NULL,
	"duration_seconds" real NOT NULL,
	"character_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"continuity" text DEFAULT '' NOT NULL,
	"frame_lineage_id" text,
	"video_lineage_id" text,
	"voice_lineage_id" text,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_videos" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"production_id" text NOT NULL,
	"concept_id" text NOT NULL,
	"title" text NOT NULL,
	"platform" text NOT NULL,
	"format" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"concept" jsonb NOT NULL,
	"script" jsonb,
	"captions" jsonb,
	"status" text DEFAULT 'concept' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storyboards" (
	"id" text PRIMARY KEY NOT NULL,
	"social_video_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timelines" (
	"id" text PRIMARY KEY NOT NULL,
	"social_video_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL,
	"render_asset_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_invocations" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"tool" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"status" text NOT NULL,
	"cost_cents" double precision DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"department" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"brief_schema" text NOT NULL,
	"steps" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"built_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_production_id_productions_id_fk" FOREIGN KEY ("production_id") REFERENCES "public"."productions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_step_id_production_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."production_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_records" ADD CONSTRAINT "analytics_records_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_characters" ADD CONSTRAINT "asset_characters_asset_id_reference_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."reference_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_characters" ADD CONSTRAINT "asset_characters_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_projects" ADD CONSTRAINT "asset_projects_asset_id_reference_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."reference_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_projects" ADD CONSTRAINT "asset_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tags" ADD CONSTRAINT "asset_tags_asset_id_reference_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."reference_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_asset_id_reference_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."reference_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_items" ADD CONSTRAINT "calendar_items_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_items" ADD CONSTRAINT "calendar_items_production_id_productions_id_fk" FOREIGN KEY ("production_id") REFERENCES "public"."productions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_production_id_productions_id_fk" FOREIGN KEY ("production_id") REFERENCES "public"."productions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canon_records" ADD CONSTRAINT "canon_records_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_versions" ADD CONSTRAINT "character_versions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_decisions" ADD CONSTRAINT "creative_decisions_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_assets" ADD CONSTRAINT "game_assets_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_assets" ADD CONSTRAINT "game_assets_production_id_productions_id_fk" FOREIGN KEY ("production_id") REFERENCES "public"."productions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_assets" ADD CONSTRAINT "generated_assets_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_assets" ADD CONSTRAINT "generated_assets_production_id_productions_id_fk" FOREIGN KEY ("production_id") REFERENCES "public"."productions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_assets" ADD CONSTRAINT "generated_assets_step_id_production_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."production_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_concepts" ADD CONSTRAINT "product_concepts_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_concepts" ADD CONSTRAINT "product_concepts_production_id_productions_id_fk" FOREIGN KEY ("production_id") REFERENCES "public"."productions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_steps" ADD CONSTRAINT "production_steps_production_id_productions_id_fk" FOREIGN KEY ("production_id") REFERENCES "public"."productions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "productions" ADD CONSTRAINT "productions_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "productions" ADD CONSTRAINT "productions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_assets" ADD CONSTRAINT "reference_assets_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_storyboard_id_storyboards_id_fk" FOREIGN KEY ("storyboard_id") REFERENCES "public"."storyboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_social_video_id_social_videos_id_fk" FOREIGN KEY ("social_video_id") REFERENCES "public"."social_videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_videos" ADD CONSTRAINT "social_videos_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_videos" ADD CONSTRAINT "social_videos_production_id_productions_id_fk" FOREIGN KEY ("production_id") REFERENCES "public"."productions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboards" ADD CONSTRAINT "storyboards_social_video_id_social_videos_id_fk" FOREIGN KEY ("social_video_id") REFERENCES "public"."social_videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timelines" ADD CONSTRAINT "timelines_social_video_id_social_videos_id_fk" FOREIGN KEY ("social_video_id") REFERENCES "public"."social_videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_org" ON "agent_runs" USING btree ("org_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_runs_step" ON "agent_runs" USING btree ("step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_org_key" ON "agents" USING btree ("org_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_org_platform_post" ON "analytics_records" USING btree ("org_id","platform","post_id");--> statement-breakpoint
CREATE INDEX "approvals_org_status" ON "approvals" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_versions_asset_version" ON "asset_versions" USING btree ("asset_id","version");--> statement-breakpoint
CREATE INDEX "audit_org_created" ON "audit_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_target" ON "audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "canon_org_domain" ON "canon_records" USING btree ("org_id","domain");--> statement-breakpoint
CREATE INDEX "canon_lineage" ON "canon_records" USING btree ("lineage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "character_versions_char_version" ON "character_versions" USING btree ("character_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "characters_org_code" ON "characters" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "comments_target" ON "comments" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "cost_org_created" ON "cost_records" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "decisions_org" ON "creative_decisions" USING btree ("org_id","active");--> statement-breakpoint
CREATE INDEX "embeddings_source" ON "embeddings" USING btree ("org_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "gen_org_status" ON "generated_assets" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "gen_lineage" ON "generated_assets" USING btree ("lineage_id");--> statement-breakpoint
CREATE INDEX "gen_production" ON "generated_assets" USING btree ("production_id");--> statement-breakpoint
CREATE INDEX "jobs_status_run_after" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "steps_production_key" ON "production_steps" USING btree ("production_id","key");--> statement-breakpoint
CREATE INDEX "productions_org_status" ON "productions" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credentials_org_key" ON "provider_credentials" USING btree ("org_id","provider_key");--> statement-breakpoint
CREATE UNIQUE INDEX "providers_org_key" ON "providers" USING btree ("org_id","provider_key");--> statement-breakpoint
CREATE INDEX "ref_org" ON "reference_assets" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ref_designation" ON "reference_assets" USING btree ("org_id","designation");--> statement-breakpoint
CREATE INDEX "shots_video" ON "shots" USING btree ("social_video_id","index");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_templates_org_key" ON "workflow_templates" USING btree ("org_id","key");