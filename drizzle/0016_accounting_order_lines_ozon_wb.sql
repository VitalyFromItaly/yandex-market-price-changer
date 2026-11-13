ALTER TABLE "accounting_order_lines" ALTER COLUMN "campaign_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounting_order_lines" ALTER COLUMN "marketplace_subsidy_kopecks" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounting_order_lines" ADD COLUMN "payout_kopecks" bigint;--> statement-breakpoint
ALTER TABLE "accounting_order_lines" ADD COLUMN "commission_kopecks" bigint;