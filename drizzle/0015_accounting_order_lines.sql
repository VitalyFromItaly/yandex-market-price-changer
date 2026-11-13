CREATE TABLE "accounting_order_line_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_id" uuid NOT NULL,
	"telegram_user_id" text NOT NULL,
	"version" integer NOT NULL,
	"value" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" text NOT NULL,
	"telegram_user_id" text NOT NULL,
	"order_id" text NOT NULL,
	"item_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"offer_id" text,
	"offer_name" text,
	"count" integer NOT NULL,
	"price_kopecks" bigint,
	"buyer_price_kopecks" bigint,
	"buyer_price_before_discount_kopecks" bigint,
	"marketplace_subsidy_kopecks" bigint NOT NULL,
	"seller_discount_kopecks" bigint,
	"revenue_kopecks" bigint,
	"status" text,
	"substatus" text,
	"created_on" text,
	"sold_on" text,
	"delivery_on" text,
	"returned_on" text,
	"source" text NOT NULL,
	"version" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_order_sync_state" (
	"telegram_user_id" text NOT NULL,
	"marketplace" text NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"last_outcome" text NOT NULL,
	"last_error" text,
	"last_success_at" timestamp with time zone,
	"cursor_at" timestamp with time zone,
	"lines_seen" integer DEFAULT 0 NOT NULL,
	"versions_written" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounting_order_line_versions" ADD CONSTRAINT "accounting_order_line_versions_line_id_accounting_order_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."accounting_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_order_line_versions_uq" ON "accounting_order_line_versions" USING btree ("line_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_order_lines_key_uq" ON "accounting_order_lines" USING btree ("marketplace","telegram_user_id","order_id","item_id");--> statement-breakpoint
CREATE INDEX "accounting_order_lines_user_created_idx" ON "accounting_order_lines" USING btree ("telegram_user_id","created_on");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_order_sync_state_uq" ON "accounting_order_sync_state" USING btree ("telegram_user_id","marketplace");