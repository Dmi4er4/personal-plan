import { requireNativeModule } from "expo-modules-core";
import type { PlanWidgetModuleApi } from "./PlanWidget.types";
export default requireNativeModule<PlanWidgetModuleApi>("PlanWidget");
