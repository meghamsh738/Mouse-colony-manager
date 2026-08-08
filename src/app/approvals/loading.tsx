import { RouteLoadingState } from "@/components/app/route-loading-state";

export default function Loading() {
  return <RouteLoadingState currentPath="/approvals" eyebrow="Approvals" title="approvals" rows={4} />;
}
