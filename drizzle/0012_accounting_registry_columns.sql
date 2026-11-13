ALTER TABLE "finance_operations" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "finance_operations" ADD COLUMN "item_id" text;--> statement-breakpoint
ALTER TABLE "finance_operations" ADD COLUMN "reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "finance_operations" ADD COLUMN "processing_status" text;--> statement-breakpoint
ALTER TABLE "finance_operations" ADD COLUMN "sub_article" text;