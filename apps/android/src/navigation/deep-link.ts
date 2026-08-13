import { useEffect } from "react";
import * as Linking from "expo-linking";

import { applyDeepLinkTab, type AppTab } from "./deep-link-routing";

export type { AppTab } from "./deep-link-routing";
export { applyDeepLinkTab, tabFromDeepLink } from "./deep-link-routing";

export function useDeepLinkTab(onTab: (tab: AppTab) => void): void {
  const url = Linking.useLinkingURL();
  useEffect(() => {
    applyDeepLinkTab(url, onTab);
  }, [url, onTab]);
  useEffect(() => {
    const subscription = Linking.addEventListener("url", ({ url: eventUrl }) => {
      applyDeepLinkTab(eventUrl, onTab);
    });
    return () => subscription.remove();
  }, [onTab]);
}
