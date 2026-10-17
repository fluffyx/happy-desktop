import type { MessageDelivery } from "../happyAgentConnection/types.js";

/**
 * How this window sends messages: which delivery a plain send uses while the
 * agent is working. The opposite one is always a modifier away.
 *
 * It is the window's own choice, like the Projects visibility switch: it is
 * about the hands at this keyboard, so it is kept by the host's storage rather
 * than by any Happy Agent the window connects to. Steer is the default, which
 * is what every send did before the choice existed.
 *
 * The constructor opens nothing: it reads the host's record once, and writes
 * back only when the reader changes the setting.
 */
export interface SendBehaviorDocument {
    readonly followUp: MessageDelivery;
}

/** Where the choice is kept. Omitting it keeps the choice for this window's lifetime only. */
export interface SendBehaviorPersistence {
    read(): SendBehaviorDocument | undefined;
    write(document: SendBehaviorDocument): void;
}

export interface SendBehaviorSnapshot {
    /** The delivery a plain send uses while the agent is working. */
    readonly followUp: MessageDelivery;
}

export interface SendBehaviorStore {
    get(): SendBehaviorSnapshot;
    subscribe(listener: () => void): () => void;
    followUpUpdate(followUp: MessageDelivery): void;
}

/** The delivery the other send key uses. */
export function messageDeliveryOpposite(delivery: MessageDelivery): MessageDelivery {
    return delivery === "steer" ? "queue" : "steer";
}

/**
 * A stored record read back as this window's own value. A field this version
 * does not recognise reads as its default, since a person can edit the host's
 * storage by hand and a later version may have written more than this one knows.
 */
function documentParse(value: unknown): SendBehaviorDocument | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const followUp = (value as { followUp?: unknown }).followUp;
    return { followUp: followUp === "queue" ? "queue" : "steer" };
}

const DEFAULT: SendBehaviorSnapshot = { followUp: "steer" };

/** Creates the window-lifetime store, hydrated from the host's storage when it has one. */
export function sendBehaviorStoreCreate(persistence?: SendBehaviorPersistence): SendBehaviorStore {
    let snapshot: SendBehaviorSnapshot = (() => {
        try {
            return documentParse(persistence?.read()) ?? DEFAULT;
        } catch {
            // Storage the host refused is a window with no record.
            return DEFAULT;
        }
    })();
    const listeners = new Set<() => void>();

    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        followUpUpdate(followUp) {
            if (snapshot.followUp === followUp) return;
            snapshot = { ...snapshot, followUp };
            try {
                persistence?.write(snapshot);
            } catch {
                // Storage the host refused still keeps this window's choice for
                // as long as it stays open.
            }
            for (const listener of listeners) listener();
        },
    };
}

/** The store a host that remembers nothing stands in: today's defaults, never changing. */
export const sendBehaviorStoreNoop: SendBehaviorStore = {
    get: () => DEFAULT,
    followUpUpdate: () => {},
    subscribe: () => () => {},
};
