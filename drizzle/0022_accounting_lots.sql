CREATE TABLE "accounting_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" text NOT NULL,
	"purchase_id" uuid NOT NULL,
	"line_index" integer NOT NULL,
	"product_id" text,
	"sku" text NOT NULL,
	"name" text,
	"count" integer NOT NULL,
	"remaining" integer NOT NULL,
	"unit_price_kopecks" bigint NOT NULL,
	"extra_kopecks" bigint NOT NULL,
	"received_day" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_purchases" ADD COLUMN "delivery_kopecks" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_purchases" ADD COLUMN "other_costs_kopecks" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_purchases" ADD COLUMN "lot_cost_split" text DEFAULT 'value' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounting_lots" ADD CONSTRAINT "accounting_lots_purchase_id_finance_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."finance_purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_lots_purchase_line_uq" ON "accounting_lots" USING btree ("purchase_id","line_index");--> statement-breakpoint
CREATE INDEX "accounting_lots_product_idx" ON "accounting_lots" USING btree ("telegram_user_id","product_id","received_day");