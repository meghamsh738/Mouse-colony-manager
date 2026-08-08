import { RouteLoadingState } from "@/components/app/route-loading-state";

export default function Loading() {
  return <RouteLoadingState currentPath="/animals" eyebrow="Colony record" title="animal record" rows={4} />;
}
