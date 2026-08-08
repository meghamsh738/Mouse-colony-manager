import { RouteLoadingState } from "@/components/app/route-loading-state";

export default function Loading() {
  return <RouteLoadingState currentPath="/scan" eyebrow="Scanner" title="cage record" rows={4} />;
}
