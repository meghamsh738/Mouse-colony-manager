type SearchParams = Record<string, string | string[] | undefined>;

export function getRequestedAction<const T extends string>(
  searchParams: SearchParams,
  allowedActions: readonly T[],
): T | undefined {
  const rawAction = searchParams.action;
  const action = Array.isArray(rawAction) ? rawAction[0] : rawAction;

  return allowedActions.find((allowedAction) => allowedAction === action);
}

export function withActionQuery(href: string, action: string) {
  const [pathname, query = ""] = href.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("action", action);
  return `${pathname}?${params.toString()}`;
}
