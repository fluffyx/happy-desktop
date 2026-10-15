import type { HappyAgentModelPreferenceDocument } from "happy-desktop-state";
import { happyAgentModelKey } from "happy-desktop-state";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { desktopConnectionPreferencesCreate } from "./desktopConnectionPreferences";

const KEY = "happy.connection-preferences.v1:remote-1";
let storage: Storage;

beforeEach(() => {
    storage = storageCreate();
    vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

it("saves a connection's switched-off models with its other choices and restores them", () => {
    const document: HappyAgentModelPreferenceDocument = {
        defaultEffort: "high",
        defaultSelection: { providerId: "codex", modelId: "sol" },
        disabledModels: [happyAgentModelKey("codex", "astra")],
        preferences: { codex: { sol: { effort: "high", serviceTier: null } } },
    };

    desktopConnectionPreferencesCreate("remote-1").write(document);

    expect(JSON.parse(storage.getItem(KEY)!)).toEqual(document);
    expect(desktopConnectionPreferencesCreate("remote-1").read()).toEqual(document);
    expect(desktopConnectionPreferencesCreate("remote-2").read()).toBeUndefined();
});

it("drops stored switches that are not a list of model keys and keeps the other choices", () => {
    for (const disabledModels of ["codex:astra", ["codex:astra", 7], { codex: "astra" }, null]) {
        storage.setItem(
            KEY,
            JSON.stringify({
                defaultEffort: "high",
                disabledModels,
                preferences: { codex: { sol: { effort: "high", serviceTier: null } } },
            }),
        );

        const restored = desktopConnectionPreferencesCreate("remote-1").read();
        expect(restored, String(disabledModels)).toEqual({
            defaultEffort: "high",
            preferences: { codex: { sol: { effort: "high", serviceTier: null } } },
        });
    }
});

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
