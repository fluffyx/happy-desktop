import type { HappyAgentClient, HistoryRun } from "@slopus/happy-agent-client";
import type { HappyAgentInboxItem, HappyAgentInboxItemId } from "./happyAgentTypes.js";

/**
 * What the asking agent said just before one waiting question, read from its
 * transcript. `none` means the question stands on its own: the run had no text
 * to show, or it could not be read while the inbox was open.
 */
export type HappyAgentInboxLeadIn =
    | { readonly type: "ready"; readonly text: string }
    | { readonly type: "none" };

/** Every lead-in read so far, by inbox item; an absent one is still being read. */
export type HappyAgentInboxLeadInsSnapshot = ReadonlyMap<
    HappyAgentInboxItemId,
    HappyAgentInboxLeadIn
>;

/**
 * The lead-ins of the questions the open inbox shows.
 *
 * Happy Agent's question resource does not carry the `context` an agent asked
 * with, so the inbox shows what the agent wrote in its turn right before asking
 * instead: part of the transcript, not a stand-in for that field. If the
 * question resource ever carries `context`, that is the better background and
 * should be preferred over this.
 *
 * Reads run only while the store has a subscriber, which is the open inbox
 * page, never the sidebar count. `itemsRequest` states the items on screen and
 * never publishes in its own call, so the page may state them while it renders.
 * A read that keeps failing settles on `none`, since the question works without
 * a lead-in, but only until the inbox closes: opening it again reads again.
 */
export interface HappyAgentInboxLeadInStore {
    get(): HappyAgentInboxLeadInsSnapshot;
    subscribe(listener: () => void): () => void;
    /**
     * The waiting items on screen now. Items no longer stated have settled, so
     * their reads stop and their lead-ins are forgotten.
     */
    itemsRequest(items: readonly HappyAgentInboxItem[]): void;
    [Symbol.dispose](): void;
}

export interface HappyAgentInboxLeadInDeps {
    readonly client: Pick<HappyAgentClient, "getMessages">;
    /**
     * How long to wait before reading again when a read fails, or when the
     * question's call is not in the transcript yet — the moment between the
     * daemon opening the question and recording the message that asked it. Its
     * length is the number of retries.
     */
    readonly retryDelaysMs?: readonly number[];
}

/** One whole run per read, so a long run is never one of many concurrent large reads. */
const CONCURRENT_READS = 4;
const RETRY_DELAYS_MS: readonly number[] = [500, 1_000, 2_000];
const EMPTY: HappyAgentInboxLeadInsSnapshot = new Map();
const NONE: HappyAgentInboxLeadIn = { type: "none" };

export function happyAgentInboxLeadInStoreCreate(
    deps: HappyAgentInboxLeadInDeps,
): HappyAgentInboxLeadInStore {
    const retryDelaysMs = deps.retryDelaysMs ?? RETRY_DELAYS_MS;
    const listeners = new Set<() => void>();
    let snapshot = EMPTY;
    /** The items on screen, by id, in the order they were stated. */
    let wanted = new Map<HappyAgentInboxItemId, HappyAgentInboxItem>();
    /** Reads under way, each with what stops it. */
    const reading = new Map<HappyAgentInboxItemId, AbortController>();
    /** Items whose `none` is a read that kept failing, read again on the next open. */
    const failed = new Set<HappyAgentInboxItemId>();
    let pruneScheduled = false;
    let disposed = false;

    const publish = (next: HappyAgentInboxLeadInsSnapshot): void => {
        snapshot = next;
        for (const listener of listeners) listener();
    };
    const settle = (itemId: HappyAgentInboxItemId, leadIn: HappyAgentInboxLeadIn): void => {
        const next = new Map(snapshot);
        next.set(itemId, leadIn);
        publish(next);
    };

    /** Rejects when the last attempt failed, or when `signal` stopped it. */
    const leadInRead = async (
        item: HappyAgentInboxItem,
        signal: AbortSignal,
    ): Promise<HappyAgentInboxLeadIn> => {
        for (let attempt = 0; ; attempt += 1) {
            let failure: { readonly error: unknown } | undefined;
            try {
                // No cursor answers with the newest runs, the one still waiting
                // on this question always whole; one message is enough to stop there.
                const page = await deps.client.getMessages(
                    item.sessionId,
                    { limit: 1, omitToolData: true },
                    { signal },
                );
                const found = happyAgentInboxLeadInSelect(page.runs, item.runId, item.requestId);
                if (found !== undefined)
                    return found === "" ? NONE : { type: "ready", text: found };
            } catch (error) {
                if (signal.aborted) throw error;
                failure = { error };
            }
            const delay = retryDelaysMs[attempt];
            if (delay === undefined) {
                if (failure !== undefined) throw failure.error;
                return NONE;
            }
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, delay);
                signal.addEventListener(
                    "abort",
                    () => {
                        clearTimeout(timer);
                        reject(signal.reason);
                    },
                    { once: true },
                );
            });
        }
    };

    /** Starts reads for wanted items not yet read, up to the concurrency cap. */
    const pump = (): void => {
        if (disposed || listeners.size === 0) return;
        for (const [itemId, item] of wanted) {
            if (reading.size >= CONCURRENT_READS) return;
            if (snapshot.has(itemId) || reading.has(itemId)) continue;
            const controller = new AbortController();
            reading.set(itemId, controller);
            void leadInRead(item, controller.signal).then(
                (leadIn) => {
                    if (controller.signal.aborted) return;
                    reading.delete(itemId);
                    settle(itemId, leadIn);
                    pump();
                },
                () => {
                    if (controller.signal.aborted) return;
                    reading.delete(itemId);
                    failed.add(itemId);
                    settle(itemId, NONE);
                    pump();
                },
            );
        }
    };

    /** Forgets settled items' lead-ins after the call that stopped stating them. */
    const prune = (): void => {
        pruneScheduled = false;
        if (disposed) return;
        let stale = false;
        for (const itemId of snapshot.keys()) if (!wanted.has(itemId)) stale = true;
        if (!stale) return;
        const next = new Map(snapshot);
        for (const itemId of next.keys()) {
            if (wanted.has(itemId)) continue;
            next.delete(itemId);
            failed.delete(itemId);
        }
        publish(next);
    };

    /** Stops every read and forgets the failed ones, so the next open reads them again. */
    const stop = (): void => {
        for (const controller of reading.values()) controller.abort();
        reading.clear();
        if (failed.size === 0) return;
        const next = new Map(snapshot);
        for (const itemId of failed) next.delete(itemId);
        failed.clear();
        publish(next);
    };

    return {
        get: () => snapshot,
        subscribe(listener) {
            if (disposed) return () => undefined;
            listeners.add(listener);
            pump();
            let released = false;
            return () => {
                if (released) return;
                released = true;
                listeners.delete(listener);
                if (listeners.size === 0) stop();
            };
        },
        itemsRequest(items) {
            if (disposed) return;
            const next = new Map(items.map((item) => [item.id, item] as const));
            if (
                next.size === wanted.size &&
                [...next.keys()].every((itemId) => wanted.has(itemId))
            ) {
                wanted = next;
                return;
            }
            for (const [itemId, controller] of reading) {
                if (next.has(itemId)) continue;
                controller.abort();
                reading.delete(itemId);
            }
            wanted = next;
            if (!pruneScheduled) {
                pruneScheduled = true;
                queueMicrotask(prune);
            }
            // Reads answer later through the subscription, never in this call.
            queueMicrotask(pump);
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            listeners.clear();
            stop();
        },
    };
}

/** Lead-ins for a Happy Agent that offers none: permanently empty, reading nothing. */
export const happyAgentInboxLeadInStoreNoop: HappyAgentInboxLeadInStore = {
    get: () => EMPTY,
    subscribe: () => () => undefined,
    itemsRequest: () => undefined,
    [Symbol.dispose]: () => undefined,
};

/**
 * What the agent said before asking one question, from the runs that hold it.
 *
 * The question's id is the id of the `request_user_input` call that asked it,
 * so the call is found by that id in the run the question names. Walking that
 * run's messages in order, consecutive text from the agent forms one stretch;
 * reasoning is passed over without ending it, and anything else — a tool call,
 * someone else's message, an image — ends it. The lead-in is the stretch the
 * question's call ends. When that one is empty, as when the agent called a tool
 * right before asking, it is the most recent stretch that said something.
 *
 * Answers `undefined` when the call is not in these runs yet, and `""` when the
 * run said nothing before it.
 */
export function happyAgentInboxLeadInSelect(
    runs: readonly HistoryRun[],
    runId: string | undefined,
    questionId: string,
): string | undefined {
    for (const run of runs) {
        if (runId !== undefined && run.id !== runId) continue;
        let stretch: string[] = [];
        let latest = "";
        const close = (): void => {
            const said = stretch.join("\n\n").trim();
            if (said !== "") latest = said;
            stretch = [];
        };
        for (const message of run.messages) {
            if (message.role !== "agent") {
                close();
                continue;
            }
            for (const block of message.content) {
                if (block.type === "text") {
                    if (block.text.trim() !== "") stretch.push(block.text.trim());
                    continue;
                }
                if (block.type === "reasoning") continue;
                if (block.type === "tool_call" && block.id === questionId) {
                    close();
                    return latest;
                }
                close();
            }
        }
    }
    return undefined;
}
