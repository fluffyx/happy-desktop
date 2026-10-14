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
            ? documentFromStored(JSON.parse(value) as HappyAgentModelPreferenceDocument)
            : undefined;
    } catch {
        /* Storage-denied windows retain in-memory choices. */
    }
    return {
        read: () => current,
        write(next) {
            current = next;
            try {
                localStorage.setItem(key, JSON.stringify(documentToStored(next)));
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
 * Reads a stored document naming both a Settings model and a chat-box pick as
 * "Last used model", with the Settings model as the pick's fallback: versions
 * before that choice existed wrote both and read them that way. Models switched
 * off in Settings are held for one run only, so none are taken from storage.
 */
function documentFromStored(
    stored: HappyAgentModelPreferenceDocument,
): HappyAgentModelPreferenceDocument {
    const { disabledModels: _disabledModels, defaultSelection, ...rest } = stored;
    if (!defaultSelection) return rest;
    return rest.lastPickedModel
        ? { ...rest, lastPickedFallback: defaultSelection }
        : { ...rest, defaultSelection };
}

/** Stores a pick's fallback where earlier versions look for it, and no switches. */
function documentToStored(
    document: HappyAgentModelPreferenceDocument,
): HappyAgentModelPreferenceDocument {
    const { disabledModels: _disabledModels, lastPickedFallback, ...rest } = document;
    return lastPickedFallback && rest.lastPickedModel && !rest.defaultSelection
        ? { ...rest, defaultSelection: lastPickedFallback }
        : rest;
}
