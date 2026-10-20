CREATE TABLE "finance_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" text NOT NULL,
	"telegram_user_id" text NOT NULL,
	"report_type" text NOT NULL,
	"period_key" text NOT NULL,
	"period_from" text NOT NULL,
	"period_to" text NOT NULL,
	"status" text NOT NULL,
	"last_outcome" text NOT NULL,
	"document_version" integer,
	"unknown_count" integer DEFAULT 0 NOT NULL,
	"changed_count" integer DEFAULT 0 NOT NULL,
	"removed_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_periods_key_uq" ON "finance_periods" USING btree ("marketplace","telegram_user_id","period_key");--> statement-breakpoint
CREATE INDEX "finance_periods_user_from_idx" ON "finance_periods" USING btree ("telegram_user_id","period_from");