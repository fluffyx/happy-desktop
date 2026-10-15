import type { HappyAgentModelKey } from "happy-desktop-state";

const MODEL_SWITCHES_KEY = "happy.model-switches.v1";

/**
 * Models switched off in Settings, kept in this window's own storage. They stay
 * out of the desktop document, whose strict validation would reject the field
 * in another installed version and reset every desktop preference.
 */
export interface DesktopModelSwitches {
    read(): readonly HappyAgentModelKey[];
    write(disabledModels: readonly HappyAgentModelKey[]): void;
}

export function desktopModelSwitchesCreate(): DesktopModelSwitches {
    return {
        read() {
            try {
                const stored = JSON.parse(localStorage.getItem(MODEL_SWITCHES_KEY) ?? "null") as {
                    readonly disabledModels?: unknown;
                } | null;
                return desktopModelKeysParse(stored?.disabledModels) ?? [];
            } catch {
                return [];
            }
        },
        write(disabledModels) {
            try {
                localStorage.setItem(MODEL_SWITCHES_KEY, JSON.stringify({ disabledModels }));
            } catch {
                // A storage-denied renderer keeps the switches for this window's lifetime.
            }
        },
    };
}

/** Stored switches come back only as a list of keys; anything else is ignored. */
export function desktopModelKeysParse(value: unknown): readonly HappyAgentModelKey[] | undefined {
    if (!Array.isArray(value)) return undefined;
    if (!value.every((key) => typeof key === "string")) return undefined;
    return value as HappyAgentModelKey[];
}
