import { RouteLoadingState } from "@/components/app/route-loading-state";

export default function Loading() {
  return <RouteLoadingState currentPath="/cages" eyebrow="Cage record" title="cage record" rows={4} />;
}
