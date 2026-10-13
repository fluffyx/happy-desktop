import { afterEach, expect, it, vi } from "vitest";
import type { HappyAgentModelPreferenceDocument } from "happy-desktop-state";
import { desktopConnectionPreferencesCreate } from "./desktopConnectionPreferences";
import { desktopConnectionUiCreate } from "./desktopConnectionUi";
import type { HappyAgentDirectoryStore } from "./happyAgentDirectoryStore";

// The app's router would bring the whole UI into a Node test; navigation is
// not what this covers.
vi.mock("happy-desktop-app", () => ({
    happyAgentHistoryCreate: () => ({ destroy: () => undefined }),
    happyAgentRouterCreate: (history: unknown) => ({ history, invalidate: async () => {} }),
}));

const KEY = "happy.connection-preferences.v1:remote";
const ALPHA = { providerId: "codex", modelId: "alpha" } as const;
const BETA = { providerId: "codex", modelId: "beta" } as const;

function storageStub(initial?: HappyAgentModelPreferenceDocument): Map<string, string> {
    const values = new Map<string, string>();
    if (initial) values.set(KEY, JSON.stringify(initial));
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
    });
    return values;
}

function stored(values: Map<string, string>): HappyAgentModelPreferenceDocument {
    return JSON.parse(values.get(KEY)!) as HappyAgentModelPreferenceDocument;
}

const directory = {
    get: () => ({ activeHappyAgentId: "remote", happyAgents: [] }),
    subscribe: () => () => undefined,
    happyAgentActivate: () => undefined,
    happyAgentReorder: () => undefined,
} as unknown as HappyAgentDirectoryStore;

afterEach(() => {
    vi.unstubAllGlobals();
});

it("reads a remote's stored choices the way the version that wrote them behaved", () => {
    storageStub({ preferences: {}, lastPickedModel: BETA });
    expect(desktopConnectionPreferencesCreate("remote").read()).toEqual({
        preferences: {},
        lastPickedModel: BETA,
    });

    storageStub({ preferences: {}, defaultSelection: ALPHA });
    expect(desktopConnectionPreferencesCreate("remote").read()).toEqual({
        preferences: {},
        defaultSelection: ALPHA,
    });

    // Both: the pick won before, so this reads as Last used model.
    storageStub({ preferences: {}, defaultSelection: ALPHA, lastPickedModel: BETA });
    expect(desktopConnectionPreferencesCreate("remote").read()).toEqual({
        preferences: {},
        lastPickedModel: BETA,
    });
});

it("pins a remote's new sessions from its Settings and returns to the last pick from it", () => {
    const values = storageStub({
        preferences: {},
        defaultSelection: ALPHA,
        lastPickedModel: BETA,
    });
    const preferences = desktopConnectionPreferencesCreate("remote");
    const ui = desktopConnectionUiCreate({
        id: "remote",
        directory,
        preferences,
        sidebarVisibility: {} as never,
    });
    expect(ui.settings.get().defaultModelId).toBeUndefined();

    ui.settings.defaultPermissionModeUpdate("read_only");
    expect(stored(values).defaultSelection).toBeUndefined();
    expect(stored(values).lastPickedModel).toEqual(BETA);

    ui.settings.defaultModelUpdate(ALPHA.providerId, ALPHA.modelId);
    expect(stored(values).defaultSelection).toEqual(ALPHA);
    expect(stored(values).lastPickedModel).toBeUndefined();

    ui.settings.defaultPermissionModeUpdate("auto");
    expect(stored(values).lastPickedModel).toBeUndefined();

    ui.settings.defaultModelClear();
    expect(stored(values).defaultSelection).toBeUndefined();
    expect(stored(values).lastPickedModel).toEqual(ALPHA);
    ui.dispose();
});
