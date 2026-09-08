CREATE TABLE IF NOT EXISTS "conversation_message_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_message_id" uuid NOT NULL,
	"project_document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_message_documents_message_document_unique" UNIQUE("conversation_message_id","project_document_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_document_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_document_chunks_document_sequence_unique" UNIQUE("project_document_id","sequence"),
	CONSTRAINT "project_document_chunks_sequence_check" CHECK ("project_document_chunks"."sequence" >= 0),
	CONSTRAINT "project_document_chunks_start_offset_check" CHECK ("project_document_chunks"."start_offset" >= 0),
	CONSTRAINT "project_document_chunks_end_offset_check" CHECK ("project_document_chunks"."end_offset" > "project_document_chunks"."start_offset"),
	CONSTRAINT "project_document_chunks_content_hash_check" CHECK ("project_document_chunks"."content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_path" text NOT NULL,
	"file_name" text NOT NULL,
	"extension" text NOT NULL,
	"media_type" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"content_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_documents_file_type_check" CHECK ((
          ("project_documents"."extension" = '.md' and "project_documents"."media_type" = 'text/markdown')
          or
          ("project_documents"."extension" = '.txt' and "project_documents"."media_type" = 'text/plain')
        )),
	CONSTRAINT "project_documents_content_hash_check" CHECK ("project_documents"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "project_documents_content_bytes_check" CHECK ("project_documents"."content_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"project_document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_documents_task_document_unique" UNIQUE("task_id","project_document_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_message_documents" ADD CONSTRAINT "conversation_message_documents_conversation_message_id_conversation_messages_id_fk" FOREIGN KEY ("conversation_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_message_documents" ADD CONSTRAINT "conversation_message_documents_project_document_id_project_documents_id_fk" FOREIGN KEY ("project_document_id") REFERENCES "public"."project_documents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_document_chunks" ADD CONSTRAINT "project_document_chunks_project_document_id_project_documents_id_fk" FOREIGN KEY ("project_document_id") REFERENCES "public"."project_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_project_document_id_project_documents_id_fk" FOREIGN KEY ("project_document_id") REFERENCES "public"."project_documents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_documents_team_id_project_path_idx" ON "project_documents" USING btree ("team_id","project_path");