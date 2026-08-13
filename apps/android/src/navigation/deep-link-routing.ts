export type AppTab = "list" | "text";

export function tabFromDeepLink(url: string | null | undefined): AppTab | null {
  if (url === null || url === undefined || url.length === 0) {
    return null;
  }
  const normalized = url.toLowerCase();
  if (normalized.includes("text")) {
    return "text";
  }
  if (normalized.includes("list") || normalized.startsWith("personalplan:")) {
    return "list";
  }
  return null;
}

export function applyDeepLinkTab(url: string | null | undefined, onTab: (tab: AppTab) => void): void {
  const tab = tabFromDeepLink(url);
  if (tab !== null) {
    onTab(tab);
  }
}
