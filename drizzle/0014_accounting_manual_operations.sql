CREATE TABLE "accounting_manual_operation_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"telegram_user_id" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"author" text NOT NULL,
	"impersonated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_manual_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" text NOT NULL,
	"client_key" uuid NOT NULL,
	"marketplace" text NOT NULL,
	"article" text NOT NULL,
	"sub_article" text,
	"amount_kopecks" bigint NOT NULL,
	"accrued_on" text NOT NULL,
	"order_id" text,
	"sku" text,
	"source" text NOT NULL,
	"document_number" text,
	"note" text,
	"author" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accounting_manual_operation_changes" ADD CONSTRAINT "accounting_manual_operation_changes_operation_id_accounting_manual_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."accounting_manual_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounting_manual_operation_changes_op_idx" ON "accounting_manual_operation_changes" USING btree ("operation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_manual_operations_client_key_uq" ON "accounting_manual_operations" USING btree ("telegram_user_id","client_key");--> statement-breakpoint
CREATE INDEX "accounting_manual_operations_user_day_idx" ON "accounting_manual_operations" USING btree ("telegram_user_id","accrued_on") WHERE "accounting_manual_operations"."deleted_at" IS NULL;