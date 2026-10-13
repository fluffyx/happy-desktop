import type { SendBehaviorDocument, SendBehaviorPersistence } from "happy-desktop-state";

const SEND_BEHAVIOR_KEY = "happy.send-behavior.v1";

/**
 * Where this machine remembers how the reader sends a message: the key that
 * sends, and what a send does while the agent is working. It is the window's
 * own storage, like the Projects visibility
 * switch: the choice is about the hands at this keyboard, so it applies to
 * every Happy Agent the window addresses and survives any of them going away.
 * An older version of the app ignores the key, sends on Enter, and keeps
 * steering.
 */
export function desktopSendBehaviorPersistence(): SendBehaviorPersistence {
    return {
        read() {
            try {
                const value = localStorage.getItem(SEND_BEHAVIOR_KEY);
                return value ? (JSON.parse(value) as SendBehaviorDocument) : undefined;
            } catch {
                return undefined;
            }
        },
        write(document) {
            try {
                localStorage.setItem(SEND_BEHAVIOR_KEY, JSON.stringify(document));
            } catch {
                // A storage-denied renderer still honours the choice for as long
                // as the window stays open.
            }
        },
    };
}
