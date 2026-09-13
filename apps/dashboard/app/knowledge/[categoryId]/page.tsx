import { KnowledgeCategoryWorkspace } from "@/components/knowledge-category-workspace";

/** Renders the dedicated browsing workspace for one persisted Knowledge Category. */
export default async function KnowledgeCategoryPage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  const { categoryId } = await params;

  return <KnowledgeCategoryWorkspace categoryId={categoryId} />;
}
