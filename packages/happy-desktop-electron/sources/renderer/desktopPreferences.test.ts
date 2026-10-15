import { happyAgentModelKey, happyAgentSettingsStoreCreate } from "happy-desktop-state";
import { afterEach, expect, it, vi } from "vitest";
import { desktopPreferencesCreate } from "./desktopPreferences";
import type { DesktopConfig, HappyDesktopBridge } from "../shared/desktopContract";

const MODEL_SWITCHES_KEY = "happy.model-switches.v1";

afterEach(() => {
    vi.unstubAllGlobals();
});

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

it("restores switched-off models into Settings and the model document after a restart", () => {
    const storage = storageCreate();
    vi.stubGlobal("localStorage", storage);
    storage.setItem(MODEL_SWITCHES_KEY, JSON.stringify({ disabledModels: ["codex:astra"] }));

    const adapter = desktopPreferencesCreate(bridgeCreate().bridge, config());

    expect(adapter.initialSettings.disabledModels).toEqual(["codex:astra"]);
    expect(adapter.preferencePersistence.read()?.disabledModels).toEqual(["codex:astra"]);
    const settings = happyAgentSettingsStoreCreate(adapter.initialSettings);
    expect(settings.get().disabledModels.has(happyAgentModelKey("codex", "astra"))).toBe(true);
});

it("saves a switch to the window's storage and never writes the desktop document", () => {
    const storage = storageCreate();
    vi.stubGlobal("localStorage", storage);
    const { bridge, desktopConfigWrite } = bridgeCreate();
    const adapter = desktopPreferencesCreate(bridge, config());
    const settings = happyAgentSettingsStoreCreate(adapter.initialSettings);
    const notified = vi.fn();
    adapter.preferencePersistence.subscribe?.(notified);

    settings.modelEnabledUpdate(happyAgentModelKey("codex", "astra"), false);
    adapter.settingsChanged(settings.get());

    expect(JSON.parse(storage.getItem(MODEL_SWITCHES_KEY)!)).toEqual({
        disabledModels: ["codex:astra"],
    });
    expect(adapter.preferencePersistence.read()?.disabledModels).toEqual(["codex:astra"]);
    expect(notified).toHaveBeenCalledOnce();
    expect(desktopConfigWrite).not.toHaveBeenCalled();

    settings.modelEnabledUpdate(happyAgentModelKey("codex", "astra"), true);
    adapter.settingsChanged(settings.get());

    expect(JSON.parse(storage.getItem(MODEL_SWITCHES_KEY)!)).toEqual({ disabledModels: [] });
    expect(adapter.preferencePersistence.read()?.disabledModels).toBeUndefined();
    const reopened = desktopPreferencesCreate(bridge, config());
    expect(reopened.initialSettings.disabledModels).toBeUndefined();
    expect(desktopConfigWrite).not.toHaveBeenCalled();
});

it("ignores stored switches that are not a list of model keys", () => {
    for (const stored of [
        "not json",
        "null",
        JSON.stringify(["codex:astra"]),
        JSON.stringify({ disabledModels: "codex:astra" }),
        JSON.stringify({ disabledModels: ["codex:astra", 7] }),
    ]) {
        const storage = storageCreate();
        vi.stubGlobal("localStorage", storage);
        storage.setItem(MODEL_SWITCHES_KEY, stored);

        const adapter = desktopPreferencesCreate(bridgeCreate().bridge, config());

        expect(adapter.initialSettings.disabledModels, stored).toBeUndefined();
        expect(adapter.preferencePersistence.read()?.disabledModels, stored).toBeUndefined();
    }
});

it("keeps switches for the window's lifetime when its storage refuses them", () => {
    vi.stubGlobal("localStorage", {
        getItem: () => {
            throw new Error("denied");
        },
        setItem: () => {
            throw new Error("denied");
        },
    });
    const { bridge, desktopConfigWrite } = bridgeCreate();
    const adapter = desktopPreferencesCreate(bridge, config());
    const settings = happyAgentSettingsStoreCreate(adapter.initialSettings);

    settings.modelEnabledUpdate(happyAgentModelKey("codex", "astra"), false);
    adapter.settingsChanged(settings.get());

    expect(adapter.preferencePersistence.read()?.disabledModels).toEqual(["codex:astra"]);
    expect(desktopConfigWrite).not.toHaveBeenCalled();
});

function config(): DesktopConfig {
    return {
        appearance: "dark",
        defaultEffort: "high",
        defaultPermissionMode: "auto",
        modelPreferences: [],
        scrollbarVisibility: "always",
        version: 1,
    };
}

function bridgeCreate() {
    const desktopConfigWrite = vi.fn(async (_config: DesktopConfig) => undefined);
    return { bridge: { desktopConfigWrite } as unknown as HappyDesktopBridge, desktopConfigWrite };
}

function storageCreate(): Storage {
    const values = new Map<string, string>();
    return {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => void values.delete(key),
        setItem: (key, value) => void values.set(key, value),
    };
}
