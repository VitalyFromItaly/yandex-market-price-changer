CREATE TABLE "accounting_cost_record_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"telegram_user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"author" text NOT NULL,
	"impersonated_by" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_cost_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"purchase" jsonb NOT NULL,
	"source" text NOT NULL,
	"author" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounting_cost_record_changes" ADD CONSTRAINT "accounting_cost_record_changes_record_id_accounting_cost_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."accounting_cost_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounting_cost_record_changes_product_idx" ON "accounting_cost_record_changes" USING btree ("telegram_user_id","product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_cost_records_key_uq" ON "accounting_cost_records" USING btree ("telegram_user_id","product_id","valid_from");