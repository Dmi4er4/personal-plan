import { type KeyboardEvent, useRef, useState } from "react";

import type { PlanStore } from "../storage/plan-store.js";
import { TextPlan } from "../ui/TextPlan.js";
import { Timeline } from "../ui/Timeline.js";
import { PairDevice } from "../ui/PairDevice.js";
import { CreationRecovery } from "../ui/CreationRecovery.js";
import { Settings } from "../ui/Settings.js";
import { useWebSync, WebSyncProvider, type WebSyncOptions } from "../sync/WebSyncProvider.js";
import "../ui/styles.css";
import { PlanProvider, type PlanProviderProps } from "./PlanProvider.js";

export interface AppProps {
  clock?: PlanProviderProps["clock"];
  onResetLocalData?: (() => void) | undefined;
  onRestoreServerData?: (() => void) | undefined;
  store: PlanStore;
  today?: PlanProviderProps["today"];
  sync?: WebSyncOptions | false;
}

type SelectedTab = "list" | "text";

function AppShell({ onResetLocalData, onRestoreServerData }: { onResetLocalData?: (() => void) | undefined; onRestoreServerData?: (() => void) | undefined }) {
  const sync = useWebSync();
  const [selectedTab, setSelectedTab] = useState<SelectedTab>("list");
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const listTab = useRef<HTMLButtonElement>(null);
  const textTab = useRef<HTMLButtonElement>(null);

  const selectAndFocus = (tab: SelectedTab): void => {
    setSelectedTab(tab);
    const target = tab === "list" ? listTab.current : textTab.current;
    target?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    let nextTab: SelectedTab | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      nextTab = selectedTab === "list" ? "text" : "list";
    } else if (event.key === "Home") {
      nextTab = "list";
    } else if (event.key === "End") {
      nextTab = "text";
    }

    if (nextTab !== null) {
      event.preventDefault();
      selectAndFocus(nextTab);
    }
  };

  if (!sync.ready) {
    return <main className="app"><p className="app-loading">Загрузка личного плана…</p></main>;
  }

  if (sync.creationRecovery !== null) {
    return <main className="app"><CreationRecovery /></main>;
  }

  if (sync.enabled && !sync.configured) {
    return <main className="app"><PairDevice /></main>;
  }

  if (settingsOpen) {
    return (
      <main className="app">
        <Settings onClose={() => { setSettingsOpen(false); }} onResetLocalData={onResetLocalData} onRestoreServerData={onRestoreServerData} />
      </main>
    );
  }

  return (
    <main className="app">
      <header className="app-header">
        <div
          aria-label="Режим плана"
          className="app-tabs"
          onKeyDown={handleTabKeyDown}
          role="tablist"
        >
          <button
            aria-controls="list-panel"
            aria-selected={selectedTab === "list"}
            className={`app-tab${selectedTab === "list" ? " app-tab--active" : ""}`}
            id="list-tab"
            onClick={() => {
              setSelectedTab("list");
            }}
            ref={listTab}
            role="tab"
            tabIndex={selectedTab === "list" ? 0 : -1}
            type="button"
          >
            Список
          </button>
          <button
            aria-controls="text-panel"
            aria-selected={selectedTab === "text"}
            className={`app-tab${selectedTab === "text" ? " app-tab--active" : ""}`}
            id="text-tab"
            onClick={() => {
              setSelectedTab("text");
            }}
            ref={textTab}
            role="tab"
            tabIndex={selectedTab === "text" ? 0 : -1}
            type="button"
          >
            Текст
          </button>
        </div>
        <div className="app-menu">
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label="Меню"
            className="app-menu-button"
            onClick={() => {
              setMenuOpen((open) => !open);
            }}
            type="button"
          >
            ⋮
          </button>
          {menuOpen ? (
            <div className="app-menu-panel" role="menu">
              <button
                className="app-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  setSettingsOpen(true);
                }}
                role="menuitem"
                type="button"
              >
                Настройки
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div
        aria-labelledby="list-tab"
        hidden={selectedTab !== "list"}
        id="list-panel"
        role="tabpanel"
      >
        <Timeline active={selectedTab === "list"} />
      </div>
      <div
        aria-labelledby="text-tab"
        hidden={selectedTab !== "text"}
        id="text-panel"
        role="tabpanel"
      >
        <TextPlan />
      </div>
    </main>
  );
}

export function App({ clock, onResetLocalData, onRestoreServerData, store, sync = false, today }: AppProps) {
  const providerProps: Omit<PlanProviderProps, "children"> = { store };
  if (clock !== undefined) {
    providerProps.clock = clock;
  }
  if (today !== undefined) {
    providerProps.today = today;
  }

  return (
    <PlanProvider {...providerProps}>
      <WebSyncProvider options={sync === false ? undefined : sync}>
        <AppShell onResetLocalData={onResetLocalData} onRestoreServerData={onRestoreServerData} />
      </WebSyncProvider>
    </PlanProvider>
  );
}
