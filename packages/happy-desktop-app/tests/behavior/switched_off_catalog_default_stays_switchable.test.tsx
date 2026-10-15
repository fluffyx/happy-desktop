import { fireEvent, render, type RenderResult } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
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

/* Switches are remembered across restarts, so the machine's own default, or a
 * chosen default restored with them, can be a model the reader switched off.
 * Settings must then mark the model a new session really starts on as the
 * default, and leave the switched-off one free to be switched back on: the
 * default's switch is locked. */

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

const ASTRA = happyAgentModelKey("codex", "astra");

const disposables: { [Symbol.dispose](): void }[] = [];

afterEach(() => {
    for (const disposable of disposables.splice(0)) disposable[Symbol.dispose]();
});

it("moves the Default badge off a switched-off catalog default and keeps its switch usable", async () => {
    const { settings, view } = await settingsRender("providers", { disabledModels: [ASTRA] });

    expect(row(view, "Sol").textContent).toContain("Default");
    expect(row(view, "Astra").textContent).not.toContain("Default");
    const astraSwitch = view.getByRole("switch", { name: "Astra enabled" });
    expect(astraSwitch.getAttribute("aria-checked")).toBe("false");
    expect(astraSwitch.hasAttribute("disabled")).toBe(false);
    expect(view.getByRole("switch", { name: "Sol enabled" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(astraSwitch);
    expect(settings.get().disabledModels.has(ASTRA)).toBe(false);
});

it("passes over a chosen default that was restored switched off", async () => {
    const chosen = {
        defaultProviderId: "codex",
        defaultModelId: "astra",
        disabledModels: [ASTRA],
    } as const;
    const providers = await settingsRender("providers", chosen);
    expect(row(providers.view, "Sol").textContent).toContain("Default");
    expect(row(providers.view, "Astra").textContent).not.toContain("Default");
    expect(
        providers.view.getByRole("switch", { name: "Astra enabled" }).hasAttribute("disabled"),
    ).toBe(false);
    providers.view.unmount();

    // General's Default model selector names the model a new session starts on.
    const general = await settingsRender("general", chosen);
    const selector = general.view.getByRole("combobox", { name: "Default model" });
    expect((selector as HTMLSelectElement).value).toBe("codex:sol");
});

async function settingsRender(
    section: string,
    initial: Parameters<typeof happyAgentSettingsStoreCreate>[0],
) {
    const settings = happyAgentSettingsStoreCreate(initial);
    const models = happyAgentModelStoreCreate({
        catalogRead: async () => CATALOG,
        preferencePersistence: {
            // The host's document mirrors the Settings store.
            read: () => {
                const current = settings.get();
                return {
                    preferences: {},
                    disabledModels: [...current.disabledModels],
                    ...(current.defaultProviderId && current.defaultModelId
                        ? {
                              defaultSelection: {
                                  providerId: current.defaultProviderId,
                                  modelId: current.defaultModelId,
                              },
                          }
                        : {}),
                };
            },
            write: () => undefined,
        },
    });
    disposables.push(models);
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
                    // Read for its change tiers, which these checks leave unset.
                    workspace: {},
                } as unknown as AppHappyAgentDirectorySnapshot["happyAgents"][number]["session"],
                status: "connected",
            },
        ],
    };
    const appearance = appearanceStoreCreate();
    disposables.push(appearance);
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
            section={section}
            settings={settings}
        />,
    );
    return { settings, view };
}

/** The Providers row that names a model. */
function row(view: RenderResult, name: string): Element {
    return view
        .getAllByText(name)
        .map((element) => element.closest('[data-happy-desktop-ui="happy-agent-provider-model"]'))
        .find((element) => element !== null)!;
}
