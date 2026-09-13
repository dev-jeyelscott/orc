CREATE TABLE IF NOT EXISTS "department_knowledge_categories" (
	"department_id" uuid NOT NULL,
	"knowledge_category_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_knowledge_categories_department_id_knowledge_category_id_unique" UNIQUE("department_id","knowledge_category_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "department_knowledge_categories" ADD CONSTRAINT "department_knowledge_categories_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "department_knowledge_categories" ADD CONSTRAINT "department_knowledge_categories_knowledge_category_id_knowledge_categories_id_fk" FOREIGN KEY ("knowledge_category_id") REFERENCES "public"."knowledge_categories"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "department_knowledge_categories_knowledge_category_id_idx" ON "department_knowledge_categories" USING btree ("knowledge_category_id");