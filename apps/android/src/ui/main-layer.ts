export type MainLayer = "none" | "menu" | "history" | "settings";

export type MainLayerEvent =
  | "toggle-menu"
  | "open-settings"
  | "open-history"
  | "close"
  | "tab"
  | "back"
  | "background";

export function reduceMainLayer(current: MainLayer, event: MainLayerEvent): MainLayer {
  if (event === "toggle-menu") {
    return current === "menu" ? "none" : "menu";
  }
  if (event === "open-settings") {
    return "settings";
  }
  if (event === "open-history") {
    return "history";
  }
  if (event === "background") {
    return current === "menu" ? "none" : current;
  }
  return "none";
}

export function shouldHandleMainBack(layer: MainLayer): boolean {
  return layer !== "none";
}
