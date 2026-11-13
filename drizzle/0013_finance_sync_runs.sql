CREATE TABLE "finance_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" text NOT NULL,
	"telegram_user_id" text NOT NULL,
	"period_key" text NOT NULL,
	"period_from" text NOT NULL,
	"period_to" text NOT NULL,
	"trigger" text NOT NULL,
	"attempt" integer NOT NULL,
	"outcome" text NOT NULL,
	"error" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "finance_sync_runs_period_idx" ON "finance_sync_runs" USING btree ("telegram_user_id","marketplace","period_key","finished_at");--> statement-breakpoint
CREATE INDEX "finance_sync_runs_finished_idx" ON "finance_sync_runs" USING btree ("finished_at");