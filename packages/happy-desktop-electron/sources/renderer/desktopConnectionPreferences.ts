import type {
    HappyAgentModelPreferenceDocument,
    HappyAgentModelPreferencePersistence,
} from "happy-desktop-state";
import { desktopModelKeysParse } from "./desktopModelSwitches";

/** A remote's model choices never share the main daemon's desktop settings document. */
export function desktopConnectionPreferencesCreate(
    id: string,
): HappyAgentModelPreferencePersistence {
    const key = `happy.connection-preferences.v1:${id}`;
    const listeners = new Set<() => void>();
    let current: HappyAgentModelPreferenceDocument | undefined;
    try {
        const value = localStorage.getItem(key);
        current = value
            ? documentRead(JSON.parse(value) as HappyAgentModelPreferenceDocument)
            : undefined;
    } catch {
        /* Storage-denied windows retain in-memory choices. */
    }
    return {
        read: () => current,
        write(next) {
            current = next;
            try {
                localStorage.setItem(key, JSON.stringify(next));
            } catch {
                /* Memory remains authoritative for this window. */
            }
            for (const listener of listeners) listener();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

/** Switched-off models are restored only as a list of keys; anything else is dropped. */
function documentRead(
    stored: HappyAgentModelPreferenceDocument,
): HappyAgentModelPreferenceDocument {
    const { disabledModels, ...document } = stored;
    const keys = desktopModelKeysParse(disabledModels);
    return keys ? { ...document, disabledModels: keys } : document;
}
