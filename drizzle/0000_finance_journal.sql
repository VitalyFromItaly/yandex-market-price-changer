CREATE TABLE "finance_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" text NOT NULL,
	"telegram_user_id" text NOT NULL,
	"business_id" text NOT NULL,
	"period_key" text NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version" integer NOT NULL,
	"kind" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" text NOT NULL,
	"telegram_user_id" text NOT NULL,
	"business_id" text NOT NULL,
	"report_type" text NOT NULL,
	"period_from" text NOT NULL,
	"period_to" text NOT NULL,
	"version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"row_count" integer,
	"error" text,
	"original" "bytea",
	"original_filename" text,
	"original_content_type" text,
	"original_size" integer,
	"original_too_large" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" text NOT NULL,
	"telegram_user_id" text NOT NULL,
	"business_id" text NOT NULL,
	"operation_key" text NOT NULL,
	"article" text DEFAULT 'unknown' NOT NULL,
	"direction" text NOT NULL,
	"amount_kopecks" bigint NOT NULL,
	"order_id" text,
	"sku" text,
	"service_name" text,
	"transaction_type" text NOT NULL,
	"transaction_source" text,
	"accrued_at" timestamp with time zone NOT NULL,
	"act_id" text,
	"act_date" timestamp with time zone,
	"model" text,
	"payment_status" text,
	"paid_at" timestamp with time zone,
	"bank_order_id" text,
	"bank_sum_kopecks" bigint,
	"document_id" uuid NOT NULL,
	"document_version" integer NOT NULL,
	"period_key" text NOT NULL,
	"last_document_id" uuid NOT NULL,
	"last_document_version" integer NOT NULL,
	"superseded_at" timestamp with time zone,
	"superseded_by_version" integer,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_corrections" ADD CONSTRAINT "finance_corrections_document_id_finance_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."finance_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_operations" ADD CONSTRAINT "finance_operations_document_id_finance_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."finance_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_operations" ADD CONSTRAINT "finance_operations_last_document_id_finance_documents_id_fk" FOREIGN KEY ("last_document_id") REFERENCES "public"."finance_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_corrections_user_created_idx" ON "finance_corrections" USING btree ("telegram_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_documents_period_version_uq" ON "finance_documents" USING btree ("marketplace","telegram_user_id","report_type","period_from","period_to","version");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_operations_key_uq" ON "finance_operations" USING btree ("marketplace","telegram_user_id","operation_key");--> statement-breakpoint
CREATE INDEX "finance_operations_user_accrued_idx" ON "finance_operations" USING btree ("telegram_user_id","accrued_at") WHERE "finance_operations"."superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX "finance_operations_period_idx" ON "finance_operations" USING btree ("telegram_user_id","period_key","last_document_id");