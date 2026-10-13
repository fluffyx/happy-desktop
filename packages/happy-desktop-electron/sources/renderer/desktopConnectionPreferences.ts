import type {
    HappyAgentModelPreferenceDocument,
    HappyAgentModelPreferencePersistence,
} from "happy-desktop-state";

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
            ? documentDefaultNormalize(JSON.parse(value) as HappyAgentModelPreferenceDocument)
            : undefined;
    } catch {
        /* Storage-denied windows retain in-memory choices. */
    }
    return {
        read: () => current,
        write(next) {
            current = next;
            // Models switched off in Settings are held for this run only.
            const { disabledModels: _disabledModels, ...stored } = next;
            try {
                localStorage.setItem(key, JSON.stringify(stored));
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

/**
 * Reads a document naming both a Settings model and a chat-box pick as "Last
 * used model", as the desktop document is read: versions that wrote both let
 * the pick win, and this one never writes both.
 */
function documentDefaultNormalize(
    document: HappyAgentModelPreferenceDocument,
): HappyAgentModelPreferenceDocument {
    if (!document.defaultSelection || !document.lastPickedModel) return document;
    const { defaultSelection: _defaultSelection, ...rest } = document;
    return rest;
}
