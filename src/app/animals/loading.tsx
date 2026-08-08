import { RouteLoadingState } from "@/components/app/route-loading-state";

export default function Loading() {
  return <RouteLoadingState currentPath="/animals" eyebrow="Colony table" title="animals" />;
}
