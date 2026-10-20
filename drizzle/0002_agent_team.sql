CREATE TABLE "mission_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"mission_id" text NOT NULL,
	"org_id" text NOT NULL,
	"parent_task_id" text,
	"agent_key" text NOT NULL,
	"title" text NOT NULL,
	"instructions" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending_tool_use_id" text,
	"pending_approval_id" text,
	"pending_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"report" text,
	"outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"cost_cents" double precision DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"goal" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"character_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"budget_cents" integer NOT NULL,
	"spent_cents" double precision DEFAULT 0 NOT NULL,
	"report" text,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cost_records" ADD COLUMN "mission_id" text;--> statement-breakpoint
ALTER TABLE "mission_tasks" ADD CONSTRAINT "mission_tasks_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mission_tasks_mission" ON "mission_tasks" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "mission_tasks_status" ON "mission_tasks" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "missions_org" ON "missions" USING btree ("org_id","created_at");