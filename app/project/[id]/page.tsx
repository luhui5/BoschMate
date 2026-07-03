import { WorkspaceView } from "@/components/workspace/workspace-view"

export function generateStaticParams() {
  // Tauri SPA: client-side routing resolves real project IDs at runtime
  return [{ id: "placeholder" }]
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <WorkspaceView projectId={id} />
}
