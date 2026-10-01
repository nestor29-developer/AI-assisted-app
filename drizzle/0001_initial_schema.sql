CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid,
	"operation" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_id" text,
	"prompt_version" text,
	"context_strategy" text,
	"retrieval" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"thinking_tokens" integer,
	"reserved_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(12, 6),
	"latency_ms" integer,
	"ttft_ms" integer,
	"finish_reason" text,
	"outcome" text DEFAULT 'in_progress' NOT NULL,
	"injection_flag" boolean DEFAULT false NOT NULL,
	"app_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_requests_operation_valid" CHECK ("ai_requests"."operation" in ('chat', 'embed_document', 'embed_query')),
	CONSTRAINT "ai_requests_outcome_valid" CHECK ("ai_requests"."outcome" in ('in_progress', 'success', 'error', 'cancelled', 'declined')),
	CONSTRAINT "ai_requests_context_strategy_valid" CHECK ("ai_requests"."context_strategy" in ('full', 'retrieval')),
	CONSTRAINT "ai_requests_tokens_non_negative" CHECK ("ai_requests"."input_tokens" >= 0 and "ai_requests"."output_tokens" >= 0 and "ai_requests"."thinking_tokens" >= 0 and "ai_requests"."reserved_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"page" integer,
	"content" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	CONSTRAINT "document_chunks_document_id_ordinal_unique" UNIQUE("document_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source_type" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"page_count" integer,
	"content" text NOT NULL,
	"token_estimate" integer NOT NULL,
	"chunk_count" integer NOT NULL,
	"embedding_model" text NOT NULL,
	"chunker_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "documents_source_type_valid" CHECK ("documents"."source_type" in ('text', 'file'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"answer" jsonb,
	"status" text DEFAULT 'completed' NOT NULL,
	"error_code" text,
	"feedback" text,
	"feedback_comment" text,
	"ai_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_role_valid" CHECK ("messages"."role" in ('user', 'assistant')),
	CONSTRAINT "messages_status_valid" CHECK ("messages"."status" in ('completed', 'failed', 'cancelled')),
	CONSTRAINT "messages_feedback_valid" CHECK ("messages"."feedback" in ('up', 'down'))
);
--> statement-breakpoint
CREATE TABLE "rate_limit_windows" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_limit_windows_window_start_key_pk" PRIMARY KEY("window_start","key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_ai_request_id_ai_requests_id_fk" FOREIGN KEY ("ai_request_id") REFERENCES "public"."ai_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_requests_user_id_created_at_idx" ON "ai_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_requests_document_id_idx" ON "ai_requests" USING btree ("document_id") WHERE "ai_requests"."document_id" is not null;--> statement-breakpoint
CREATE INDEX "documents_user_id_created_at_idx" ON "documents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_expires_at_idx" ON "documents" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "messages_document_id_created_at_idx" ON "messages" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_ai_request_id_idx" ON "messages" USING btree ("ai_request_id") WHERE "messages"."ai_request_id" is not null;