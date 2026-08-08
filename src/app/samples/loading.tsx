import { RouteLoadingState } from "@/components/app/route-loading-state";

export default function Loading() {
  return <RouteLoadingState currentPath="/samples" eyebrow="Biosamples" title="biosamples" />;
}
