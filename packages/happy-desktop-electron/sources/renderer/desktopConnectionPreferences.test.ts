import { afterEach, expect, it, vi } from "vitest";
import {
    happyAgentModelKey,
    happyAgentModelStoreCreate,
    type HappyAgentModel,
    type HappyAgentModelCatalog,
    type HappyAgentModelPreferenceDocument,
    type HappyAgentModelStore,
} from "happy-desktop-state";
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
/** A pick on an account the remote no longer has. */
const GONE = { providerId: "retired", modelId: "gone" } as const;

function model(id: string): HappyAgentModel {
    return {
        id,
        name: id,
        serviceTierOptions: [{ id: null, label: "Regular" }],
        thinkingLevels: ["low", "medium", "high"],
        defaultThinkingLevel: "medium",
    };
}

const catalog: HappyAgentModelCatalog = {
    defaultProviderId: "codex",
    defaultModelId: "gamma",
    models: [model("alpha"), model("beta"), model("gamma")],
    providers: [
        {
            id: "codex",
            type: "codex",
            enabled: true,
            hidden: false,
            models: [model("alpha"), model("beta"), model("gamma")],
        },
    ],
};

/** The renderer's wiring for one remote: its storage, its Settings, and its model store. */
async function remoteOpen() {
    const preferences = desktopConnectionPreferencesCreate("remote");
    const ui = desktopConnectionUiCreate({
        id: "remote",
        directory,
        preferences,
        sidebarVisibility: {} as never,
    });
    const models = happyAgentModelStoreCreate({
        catalogRead: async () => catalog,
        preferencePersistence: preferences,
    });
    await models.load();
    return { preferences, ui, models };
}

function startsWith(models: HappyAgentModelStore) {
    const snapshot = models.get();
    if (snapshot.type !== "ready") throw new Error("Model store not ready");
    return snapshot.lastUsedSelection;
}

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

    // Both: the pick won before, falling back to the Settings model, so this
    // reads as Last used model with that fallback.
    storageStub({ preferences: {}, defaultSelection: ALPHA, lastPickedModel: BETA });
    expect(desktopConnectionPreferencesCreate("remote").read()).toEqual({
        preferences: {},
        lastPickedModel: BETA,
        lastPickedFallback: ALPHA,
    });

    // Switches are held for one run only; none come back from storage.
    storageStub({
        preferences: {},
        disabledModels: [happyAgentModelKey(ALPHA.providerId, ALPHA.modelId)],
    });
    expect(desktopConnectionPreferencesCreate("remote").read()).toEqual({ preferences: {} });
});

it("falls back to the Settings model an earlier version kept beside an unavailable remote pick", async () => {
    const values = storageStub({ preferences: {}, defaultSelection: ALPHA, lastPickedModel: GONE });
    const { ui, models } = await remoteOpen();
    expect(ui.settings.get().defaultModelId).toBeUndefined();
    expect(startsWith(models)).toMatchObject(ALPHA);

    // Saved where earlier versions look for it.
    ui.settings.defaultPermissionModeUpdate("read_only");
    expect(stored(values)).toMatchObject({ defaultSelection: ALPHA, lastPickedModel: GONE });
    expect(stored(values).lastPickedFallback).toBeUndefined();
    expect(stored(values).disabledModels).toBeUndefined();

    models.selectionUsed({ ...BETA, permissionMode: "read_only", effort: "low" });
    expect(stored(values)).toMatchObject({ defaultSelection: ALPHA, lastPickedModel: BETA });
    expect(startsWith(models)).toMatchObject(BETA);
    ui.settings.modelEnabledUpdate(happyAgentModelKey(BETA.providerId, BETA.modelId), false);
    expect(startsWith(models)).toMatchObject(ALPHA);
    models[Symbol.dispose]();
    ui.dispose();
});

it("pins a remote's new sessions from its Settings and returns to the last pick from it", async () => {
    const values = storageStub({
        preferences: { codex: { alpha: { effort: "low", serviceTier: null } } },
        defaultSelection: GONE,
        lastPickedModel: BETA,
    });
    const { ui, models } = await remoteOpen();
    expect(ui.settings.get().defaultModelId).toBeUndefined();
    expect(startsWith(models)).toMatchObject(BETA);

    ui.settings.defaultModelUpdate(ALPHA.providerId, ALPHA.modelId);
    ui.settings.defaultEffortUpdate("high");
    expect(stored(values).defaultSelection).toEqual(ALPHA);
    expect(stored(values).lastPickedModel).toBeUndefined();
    expect(startsWith(models)).toMatchObject({ ...ALPHA, effort: "high" });

    // A chat-box pick stays in its own session.
    models.selectionUsed({ ...BETA, permissionMode: "auto", effort: "low" });
    expect(stored(values).lastPickedModel).toBeUndefined();
    expect(startsWith(models)).toMatchObject(ALPHA);

    ui.settings.defaultPermissionModeUpdate("read_only");
    expect(stored(values).lastPickedModel).toBeUndefined();

    // Last used model starts on the pinned model with the effort it was
    // pinned with, not an older remembered one, and no stale fallback.
    ui.settings.defaultModelClear();
    expect(stored(values).defaultSelection).toBeUndefined();
    expect(stored(values).lastPickedModel).toEqual(ALPHA);
    expect(startsWith(models)).toMatchObject({ ...ALPHA, effort: "high" });
    models[Symbol.dispose]();
    ui.dispose();

    const reopened = await remoteOpen();
    expect(reopened.ui.settings.get().defaultModelId).toBeUndefined();
    expect(startsWith(reopened.models)).toMatchObject({ ...ALPHA, effort: "high" });
    reopened.models[Symbol.dispose]();
    reopened.ui.dispose();
});
