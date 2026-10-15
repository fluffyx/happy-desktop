import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
    appearanceStoreCreate,
    happyAgentModelKey,
    happyAgentModelStoreCreate,
    happyAgentSettingsStoreCreate,
    type HappyAgentConnectionStore,
    type HappyAgentModelCatalog,
    type HappyAgentProvidersStore,
} from "happy-desktop-state";
import { AppHappyAgentSettingsView } from "../../sources/views/AppHappyAgentSettingsView";
import type { AppHappyAgentDirectorySnapshot } from "../../sources/AppHappyAgentView";

// jsdom has no canvas; the offline model-catalog spinner is unrelated here.
vi.mock("../../../happy-desktop-ui/src/Spinner", () => ({ Spinner: () => null }));

/* Switches are remembered across restarts, so the machine's own default can
 * later become a model the reader switched off. Settings must then mark the
 * model a new session really starts on as the default, and leave the
 * switched-off one free to be switched back on: the default's switch is locked. */

const MODEL = {
    defaultThinkingLevel: "medium",
    serviceTierOptions: [{ id: null, label: "Regular" }],
    thinkingLevels: ["low", "medium", "high"],
} as const;

const CATALOG: HappyAgentModelCatalog = {
    defaultModelId: "astra",
    defaultProviderId: "codex",
    models: [],
    providers: [
        {
            enabled: true,
            hidden: false,
            id: "codex",
            models: [
                { ...MODEL, id: "astra", name: "Astra" },
                { ...MODEL, id: "sol", name: "Sol" },
            ],
            type: "codex",
        },
    ],
};

const CONNECTED = { connection: "connected", daemon: "ready", attempt: 0 } as const;

const PROVIDERS = {
    loading: false,
    providers: CATALOG.providers.map((provider) => ({ ...provider, saving: false })),
};

it("moves the Default badge off a switched-off catalog default and keeps its switch usable", async () => {
    const astra = happyAgentModelKey("codex", "astra");
    const settings = happyAgentSettingsStoreCreate({ disabledModels: [astra] });
    const models = happyAgentModelStoreCreate({
        catalogRead: async () => CATALOG,
        preferencePersistence: {
            read: () => ({ preferences: {}, disabledModels: [...settings.get().disabledModels] }),
            write: () => undefined,
        },
    });
    await models.load();
    const directory: AppHappyAgentDirectorySnapshot = {
        happyAgents: [
            {
                bots: [],
                id: "local",
                label: "This Mac",
                projects: [],
                projectsStatus: "ready",
                session: {
                    connection: {
                        get: () => CONNECTED,
                        subscribe: () => () => undefined,
                    } as unknown as HappyAgentConnectionStore,
                    models,
                    providers: {
                        get: () => PROVIDERS,
                        subscribe: () => () => undefined,
                        providerEnabledUpdate: () => undefined,
                    } as unknown as HappyAgentProvidersStore,
                    // Read for its change tiers, which this category does not show.
                    workspace: {},
                } as unknown as AppHappyAgentDirectorySnapshot["happyAgents"][number]["session"],
                status: "connected",
            },
        ],
    };
    const appearance = appearanceStoreCreate();
    const view = render(
        <AppHappyAgentSettingsView
            appearance={appearance}
            happyAgents={{
                get: () => directory,
                subscribe: () => () => {},
                happyAgentActivate: () => {},
            }}
            onCategorySelect={() => {}}
            onClose={() => {}}
            section="providers"
            settings={settings}
        />,
    );
    const row = (name: string) =>
        view
            .getAllByText(name)
            .map((element) =>
                element.closest('[data-happy-desktop-ui="happy-agent-provider-model"]'),
            )
            .find((element) => element !== null)!;

    expect(row("Sol").textContent).toContain("Default");
    expect(row("Astra").textContent).not.toContain("Default");
    const astraSwitch = view.getByRole("switch", { name: "Astra enabled" });
    expect(astraSwitch.getAttribute("aria-checked")).toBe("false");
    expect(astraSwitch.hasAttribute("disabled")).toBe(false);
    expect(view.getByRole("switch", { name: "Sol enabled" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(astraSwitch);
    expect(settings.get().disabledModels.has(astra)).toBe(false);
    view.unmount();
    models[Symbol.dispose]();
    appearance[Symbol.dispose]();
});
