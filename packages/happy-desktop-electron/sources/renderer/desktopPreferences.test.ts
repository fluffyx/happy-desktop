import { expect, it, vi } from "vitest";
import {
    happyAgentModelKey,
    happyAgentModelStoreCreate,
    happyAgentSettingsStoreCreate,
    type HappyAgentModel,
    type HappyAgentModelCatalog,
    type HappyAgentModelStore,
} from "happy-desktop-state";
import { desktopConfigValidate } from "../main/desktopConfig";
import { desktopPreferencesCreate } from "./desktopPreferences";
import type { DesktopConfig, HappyDesktopBridge } from "../shared/desktopContract";

it("retains Ultrafast in the desktop document and restores it without losing unrelated preferences", () => {
    const initial: DesktopConfig = {
        appearance: "dark",
        defaultEffort: "high",
        defaultPermissionMode: "auto",
        scrollbarVisibility: "always",
        titleShimmerEnabled: false,
        version: 1,
        modelPreferences: [
            { providerId: "codex", modelId: "astra", lastEffort: "high", lastSpeed: "ultrafast" },
        ],
    };
    const desktopConfigWrite = vi.fn(async (_config: DesktopConfig) => undefined);
    const bridge = { desktopConfigWrite } as unknown as HappyDesktopBridge;
    const adapter = desktopPreferencesCreate(bridge, initial);
    expect(adapter.preferencePersistence.read()?.preferences.codex?.astra?.serviceTier).toBe(
        "ultrafast",
    );
    const document = adapter.preferencePersistence.read()!;
    adapter.preferencePersistence.write(document);
    const saved = desktopConfigWrite.mock.calls[0]![0];
    expect(saved.modelPreferences[0]?.lastSpeed).toBe("ultrafast");
    expect(saved).toMatchObject({
        appearance: "dark",
        scrollbarVisibility: "always",
        titleShimmerEnabled: false,
    });
    const reopened = desktopPreferencesCreate(bridge, saved);
    expect(reopened.preferencePersistence.read()?.preferences.codex?.astra?.serviceTier).toBe(
        "ultrafast",
    );
});

const ALPHA = { providerId: "codex", modelId: "alpha" } as const;
const BETA = { providerId: "codex", modelId: "beta" } as const;
const GAMMA = { providerId: "codex", modelId: "gamma" } as const;
/** A pick on an account this machine no longer has. */
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
    defaultModelId: "alpha",
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

function configCreate(fields: Partial<DesktopConfig>): DesktopConfig {
    return {
        appearance: "system",
        defaultEffort: "medium",
        defaultPermissionMode: "auto",
        modelPreferences: [],
        scrollbarVisibility: "automatic",
        version: 1,
        ...fields,
    };
}

/** The renderer's wiring for the local connection: one adapter, Settings, and the model store. */
async function desktopOpen(initial: DesktopConfig) {
    const desktopConfigWrite = vi.fn(async (_config: DesktopConfig) => undefined);
    const bridge = { desktopConfigWrite } as unknown as HappyDesktopBridge;
    const preferences = desktopPreferencesCreate(bridge, initial);
    const settings = happyAgentSettingsStoreCreate(preferences.initialSettings);
    settings.subscribe(() => preferences.settingsChanged(settings.get()));
    const models = happyAgentModelStoreCreate({
        catalogRead: async () => catalog,
        preferencePersistence: preferences.preferencePersistence,
    });
    await models.load();
    const saved = (): DesktopConfig | undefined => desktopConfigWrite.mock.calls.at(-1)?.[0];
    return { desktopConfigWrite, preferences, saved, settings, models };
}

function startsWith(models: HappyAgentModelStore) {
    const snapshot = models.get();
    if (snapshot.type !== "ready") throw new Error("Model store not ready");
    return snapshot.lastUsedSelection;
}

function startsOn(models: HappyAgentModelStore) {
    const { providerId, modelId } = startsWith(models);
    return { providerId, modelId };
}

it("reads an existing desktop document the way the version that wrote it behaved", async () => {
    // No Settings model: Last used model, as before.
    const unset = await desktopOpen(configCreate({ lastPickedModel: BETA }));
    expect(unset.settings.get().defaultModelId).toBeUndefined();
    expect(startsOn(unset.models)).toEqual(BETA);

    // Only a Settings model: pinned to it, as before.
    const pinned = await desktopOpen(configCreate({ defaultModel: { ...ALPHA, effort: "high" } }));
    expect(pinned.settings.get()).toMatchObject({ defaultModelId: "alpha" });
    expect(startsOn(pinned.models)).toEqual(ALPHA);

    // Both: the pick won before, so this reads as Last used model.
    const both = await desktopOpen(
        configCreate({ defaultModel: { ...ALPHA, effort: "high" }, lastPickedModel: BETA }),
    );
    expect(both.settings.get().defaultModelId).toBeUndefined();
    expect(both.preferences.preferencePersistence.read()?.defaultSelection).toBeUndefined();
    expect(startsOn(both.models)).toEqual(BETA);

    // Both, with the pick unavailable: the Settings model stood in, and still does.
    const gone = await desktopOpen(
        configCreate({ defaultModel: { ...GAMMA, effort: "high" }, lastPickedModel: GONE }),
    );
    expect(gone.settings.get().defaultModelId).toBeUndefined();
    expect(startsWith(gone.models)).toMatchObject({ ...GAMMA, effort: "high" });

    // Reading changes nothing on disk until something is saved.
    for (const opened of [unset, pinned, both, gone])
        expect(opened.desktopConfigWrite).not.toBeCalled();
});

it("pins new sessions to a Settings model and returns to the last pick from it", async () => {
    const { desktopConfigWrite, saved, settings, models } = await desktopOpen(
        configCreate({ defaultModel: { ...ALPHA, effort: "high" }, lastPickedModel: BETA }),
    );

    // Saving another setting keeps the reading: Last used model on the pick,
    // with the Settings model still beside it as the fallback.
    settings.defaultPermissionModeUpdate("read_only");
    expect(saved()?.defaultModel).toMatchObject(ALPHA);
    expect(saved()?.lastPickedModel).toEqual(BETA);

    // Choosing a model pins it, and no pick is kept beside it.
    settings.defaultModelUpdate(GAMMA.providerId, GAMMA.modelId);
    expect(saved()?.defaultModel).toMatchObject(GAMMA);
    expect(saved()?.lastPickedModel).toBeUndefined();
    expect(startsOn(models)).toEqual(GAMMA);
    const pinnedConfig = saved();

    // A chat-box pick changes its own session only and writes nothing.
    const writes = desktopConfigWrite.mock.calls.length;
    models.selectionUsed({ ...BETA, permissionMode: "auto", effort: "low" });
    expect(desktopConfigWrite.mock.calls.length).toBe(writes);
    expect(startsOn(models)).toEqual(GAMMA);

    // Other settings no longer put a pick back.
    settings.defaultPermissionModeUpdate("auto");
    expect(saved()?.defaultModel).toMatchObject(GAMMA);
    expect(saved()?.lastPickedModel).toBeUndefined();

    // Last used model starts from the model that was pinned, with the effort
    // it was pinned with, until the next pick.
    settings.defaultEffortUpdate("high");
    settings.defaultModelClear();
    expect(saved()?.defaultModel).toBeUndefined();
    expect(saved()?.lastPickedModel).toEqual(GAMMA);
    expect(startsWith(models)).toMatchObject({ ...GAMMA, effort: "high" });
    models.selectionUsed({ ...BETA, permissionMode: "auto", effort: "low" });
    expect(saved()?.lastPickedModel).toEqual(BETA);
    expect(startsOn(models)).toEqual(BETA);

    // Every save is a document the main process accepts as it is.
    for (const [config] of desktopConfigWrite.mock.calls)
        expect(desktopConfigValidate(config)).toEqual(config);
    const reopenedPinned = await desktopOpen(pinnedConfig!);
    expect(reopenedPinned.settings.get()).toMatchObject({ defaultModelId: "gamma" });
    expect(startsOn(reopenedPinned.models)).toEqual(GAMMA);
    const reopened = await desktopOpen(saved()!);
    expect(reopened.settings.get().defaultModelId).toBeUndefined();
    expect(startsOn(reopened.models)).toEqual(BETA);
});

it("falls back to the Settings model an earlier version kept beside an unavailable pick", async () => {
    const { desktopConfigWrite, saved, settings, models } = await desktopOpen(
        configCreate({ defaultModel: { ...GAMMA, effort: "high" }, lastPickedModel: GONE }),
    );
    expect(startsWith(models)).toMatchObject({ ...GAMMA, effort: "high" });

    // Other settings keep the fallback on disk, as earlier versions wrote it.
    settings.defaultPermissionModeUpdate("read_only");
    expect(saved()).toMatchObject({ defaultModel: GAMMA, lastPickedModel: GONE });

    // A usable pick wins; switching it off in Settings falls back again.
    models.selectionUsed({ ...BETA, permissionMode: "read_only", effort: "low" });
    expect(saved()).toMatchObject({ defaultModel: GAMMA, lastPickedModel: BETA });
    expect(startsOn(models)).toEqual(BETA);
    settings.modelEnabledUpdate(happyAgentModelKey(BETA.providerId, BETA.modelId), false);
    expect(startsWith(models)).toMatchObject({ ...GAMMA, effort: "high" });

    for (const [config] of desktopConfigWrite.mock.calls)
        expect(desktopConfigValidate(config)).toEqual(config);
    const reopened = await desktopOpen(saved()!);
    expect(reopened.settings.get().defaultModelId).toBeUndefined();
    expect(startsOn(reopened.models)).toEqual(BETA);
});
