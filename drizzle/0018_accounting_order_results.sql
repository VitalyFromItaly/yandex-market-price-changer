CREATE TABLE "accounting_order_result_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_id" uuid NOT NULL,
	"telegram_user_id" text NOT NULL,
	"version" integer NOT NULL,
	"state" text NOT NULL,
	"value" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"reason" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_order_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" text NOT NULL,
	"telegram_user_id" text NOT NULL,
	"order_id" text NOT NULL,
	"version" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"state" text NOT NULL,
	"net_kopecks" bigint,
	"confirmed_kopecks" bigint NOT NULL,
	"expected_kopecks" bigint NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounting_order_result_versions" ADD CONSTRAINT "accounting_order_result_versions_result_id_accounting_order_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."accounting_order_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_order_result_versions_uq" ON "accounting_order_result_versions" USING btree ("result_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_order_results_key_uq" ON "accounting_order_results" USING btree ("marketplace","telegram_user_id","order_id");