import type {
    HistoryRun,
    Message,
    MessageHistoryQuery,
    MessageHistoryResponse,
} from "@slopus/happy-agent-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAgentMessage, fakeRun, fakeUserMessage } from "../testing/fakeHappyAgentDaemon.js";
import {
    happyAgentInboxLeadInSelect,
    happyAgentInboxLeadInStoreCreate,
    type HappyAgentInboxLeadInStore,
} from "./happyAgentInboxLeadInStore.js";
import type {
    HappyAgentInboxItem,
    HappyAgentInboxItemId,
    HappyAgentSessionId,
} from "./happyAgentTypes.js";

type Block = Extract<Message, { role: "agent" }>["content"][number];

const text = (value: string): Block => ({ type: "text", text: value });
const reasoning = (value: string): Block => ({ type: "reasoning", text: value });
const call = (id: string, name = "exec_command"): Block =>
    ({
        type: "tool_call",
        id,
        name,
        status: "completed",
        arguments: {},
        result: { output: "" },
    }) as Block;
const agent = (id: string, ...content: Block[]): Message => fakeAgentMessage({ id, content });
const run = (id: string, ...messages: Message[]): HistoryRun => fakeRun({ id, messages });

describe("happyAgentInboxLeadInSelect", () => {
    it("is the text the question's call ends, joined across messages and past reasoning", () => {
        const runs = [
            run(
                "run-1",
                fakeUserMessage({ id: "user-1" }),
                agent("a1", text("Earlier narration."), call("tool-1")),
                agent("a2", text("The table is 40 GB."), reasoning("Thinking it over.")),
                agent(
                    "a3",
                    text("Two ways to migrate it."),
                    call("question-1", "request_user_input"),
                ),
            ),
        ];
        expect(happyAgentInboxLeadInSelect(runs, "run-1", "question-1")).toBe(
            "The table is 40 GB.\n\nTwo ways to migrate it.",
        );
    });

    it("falls back to the latest stretch that said something when a tool call came right before", () => {
        // A Claude session often loads the ask tool with a ToolSearch first.
        const runs = [
            run(
                "run-1",
                agent("a1", text("First stretch.")),
                agent("a2", call("tool-1"), text("I need a decision on the migration.")),
                agent("a3", call("tool-search"), reasoning("Loading the tool.")),
                agent("a4", call("question-1", "request_user_input")),
            ),
        ];
        expect(happyAgentInboxLeadInSelect(runs, "run-1", "question-1")).toBe(
            "I need a decision on the migration.",
        );
    });

    it("is empty when the run said nothing before asking", () => {
        const runs = [
            run("run-1", agent("a1", reasoning("Hm."), call("tool-1"), call("question-1"))),
        ];
        expect(happyAgentInboxLeadInSelect(runs, "run-1", "question-1")).toBe("");
    });

    it("lets someone else's message end a stretch", () => {
        const runs = [
            run(
                "run-1",
                agent("a1", text("Before the steer.")),
                fakeUserMessage({ id: "steer" }),
                agent("a2", call("question-1")),
            ),
        ];
        // The steer ends the stretch, so the question's own is empty and the
        // fallback finds the one before it.
        expect(happyAgentInboxLeadInSelect(runs, "run-1", "question-1")).toBe("Before the steer.");
    });

    it("does not know yet when the call is not in the run, and reads only the named run", () => {
        const runs = [
            run("run-old", agent("a1", text("Old run."), call("question-1"))),
            run("run-1", agent("a2", text("Still writing."))),
        ];
        expect(happyAgentInboxLeadInSelect(runs, "run-1", "question-1")).toBeUndefined();
        // Without a run named, the call is found wherever it is.
        expect(happyAgentInboxLeadInSelect(runs, undefined, "question-1")).toBe("Old run.");
    });
});

const item = (id: string, overrides: Partial<HappyAgentInboxItem> = {}): HappyAgentInboxItem => ({
    id: `agent-${id}/question-${id}` as HappyAgentInboxItemId,
    sessionId: `agent-${id}` as HappyAgentSessionId,
    requestId: `question-${id}`,
    runId: `run-${id}`,
    questions: [],
    status: "pending",
    createdAt: 1,
    ...overrides,
});

interface Read {
    readonly agentId: string;
    readonly query: MessageHistoryQuery | undefined;
    readonly signal: AbortSignal | undefined;
    respond(runs: readonly HistoryRun[]): void;
    fail(error: Error): void;
}

/** A `getMessages` the test answers by hand, one read at a time. */
function clientCreate() {
    const reads: Read[] = [];
    const client = {
        getMessages(
            agentId: string,
            query?: MessageHistoryQuery,
            options?: { signal?: AbortSignal },
        ): Promise<MessageHistoryResponse> {
            return new Promise((resolve, reject) => {
                options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
                reads.push({
                    agentId,
                    query,
                    signal: options?.signal,
                    respond: (runs) => resolve({ cursor: "c", hasMore: false, runs: [...runs] }),
                    fail: reject,
                });
            });
        },
    };
    return { client, reads };
}

/** A run in which `id`'s agent says `said` and then asks its question. */
const asking = (id: string, said: string): HistoryRun[] => [
    run(`run-${id}`, agent(`a-${id}`, text(said), call(`question-${id}`))),
];

const stores: HappyAgentInboxLeadInStore[] = [];
afterEach(() => {
    for (const store of stores.splice(0)) store[Symbol.dispose]();
});

function storeCreate(retryDelaysMs: readonly number[] = []) {
    const { client, reads } = clientCreate();
    const store = happyAgentInboxLeadInStoreCreate({ client, retryDelaysMs });
    stores.push(store);
    return { reads, store };
}

/**
 * Moves fake time on by `ms`, then lets every read the store started or
 * answered run its promise chain to the end, one turn at a time.
 */
async function settled(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    for (let turn = 0; turn < 20; turn += 1) await vi.advanceTimersByTimeAsync(0);
}

describe("happyAgentInboxLeadInStore", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("reads only while subscribed, never in the call that states the items", async () => {
        const { reads, store } = storeCreate();
        const one = item("one");
        store.itemsRequest([one]);
        await settled();
        expect(reads).toEqual([]);

        const notified = vi.fn();
        store.subscribe(notified);
        store.itemsRequest([one]);
        expect(notified).not.toHaveBeenCalled();
        await settled();
        expect(reads).toHaveLength(1);
        expect(reads[0]).toMatchObject({
            agentId: "agent-one",
            query: { limit: 1, omitToolData: true },
        });

        reads[0]!.respond(asking("one", "Here is the situation."));
        await settled();
        expect(store.get().get(one.id)).toEqual({
            type: "ready",
            text: "Here is the situation.",
        });
        expect(notified).toHaveBeenCalled();
    });

    it("settles on none when the run said nothing, or the read failed", async () => {
        const { reads, store } = storeCreate();
        const quiet = item("quiet");
        const broken = item("broken");
        store.subscribe(() => undefined);
        store.itemsRequest([quiet, broken]);
        await settled();
        expect(reads).toHaveLength(2);

        reads[0]!.respond([run("run-quiet", agent("a", call("question-quiet")))]);
        reads[1]!.fail(new Error("The Happy Agent is unreachable."));

        await settled();
        expect(store.get().get(broken.id)).toEqual({ type: "none" });
        expect(store.get().get(quiet.id)).toEqual({ type: "none" });
    });

    it("reads again after a failed read", async () => {
        const { reads, store } = storeCreate([500]);
        const one = item("one");
        store.subscribe(() => undefined);
        store.itemsRequest([one]);
        await settled();
        expect(reads).toHaveLength(1);

        reads[0]!.fail(new Error("The Happy Agent is unreachable."));
        await settled(499);
        // Waiting out the delay, not reading again straight away.
        expect(reads).toHaveLength(1);
        expect(store.get().has(one.id)).toBe(false);
        await settled(1);
        expect(reads).toHaveLength(2);

        reads[1]!.respond(asking("one", "Back again."));
        await settled();
        expect(store.get().get(one.id)).toEqual({ type: "ready", text: "Back again." });
    });

    it("reads a failed question again when the page opens again, but not one that said nothing", async () => {
        const { reads, store } = storeCreate();
        const quiet = item("quiet");
        const broken = item("broken");
        const unsubscribe = store.subscribe(() => undefined);
        store.itemsRequest([quiet, broken]);
        await settled();
        expect(reads).toHaveLength(2);
        reads[0]!.respond([run("run-quiet", agent("a", call("question-quiet")))]);
        reads[1]!.fail(new Error("The Happy Agent is unreachable."));
        await settled();
        expect(store.get().size).toBe(2);

        unsubscribe();
        expect(store.get().has(broken.id)).toBe(false);
        expect(store.get().get(quiet.id)).toEqual({ type: "none" });

        store.subscribe(() => undefined);
        store.itemsRequest([quiet, broken]);
        await settled();
        expect(reads).toHaveLength(3);
        expect(reads[2]!.agentId).toBe("agent-broken");
        reads[2]!.respond(asking("broken", "Reachable now."));
        await settled();
        expect(store.get().get(broken.id)).toEqual({ type: "ready", text: "Reachable now." });
        expect(reads).toHaveLength(3);
    });

    it("reads again while the asking message is not recorded yet", async () => {
        const { reads, store } = storeCreate([500]);
        const one = item("one");
        store.subscribe(() => undefined);
        store.itemsRequest([one]);
        await settled();
        expect(reads).toHaveLength(1);

        reads[0]!.respond([run("run-one", agent("a", text("Still writing…")))]);
        await settled(500);
        expect(reads).toHaveLength(2);
        expect(store.get().has(one.id)).toBe(false);

        reads[1]!.respond(asking("one", "Now it is recorded."));
        await settled();
        expect(store.get().get(one.id)).toEqual({ type: "ready", text: "Now it is recorded." });
    });

    it("gives up quietly when the call never shows up", async () => {
        const { reads, store } = storeCreate([500]);
        const one = item("one");
        store.subscribe(() => undefined);
        store.itemsRequest([one]);
        await settled();
        expect(reads).toHaveLength(1);
        reads[0]!.respond([]);
        await settled(500);
        expect(reads).toHaveLength(2);
        reads[1]!.respond([]);
        await settled();
        expect(store.get().get(one.id)).toEqual({ type: "none" });
        await settled(10_000);
        expect(reads).toHaveLength(2);
    });

    it("stops reading when the page closes and reuses what it read when it opens again", async () => {
        const { reads, store } = storeCreate();
        const one = item("one");
        const two = item("two");
        const unsubscribe = store.subscribe(() => undefined);
        store.itemsRequest([one, two]);
        await settled();
        expect(reads).toHaveLength(2);
        reads[0]!.respond(asking("one", "One's lead-in."));
        await settled();
        expect(store.get().has(one.id)).toBe(true);

        unsubscribe();
        expect(reads[1]!.signal?.aborted).toBe(true);

        store.subscribe(() => undefined);
        store.itemsRequest([one, two]);
        // Only the read that never finished starts again.
        await settled();
        expect(reads).toHaveLength(3);
        expect(reads[2]!.agentId).toBe("agent-two");
        expect(store.get().get(one.id)).toEqual({ type: "ready", text: "One's lead-in." });
    });

    it("stops reading and forgets a question once it settles", async () => {
        const { reads, store } = storeCreate();
        const one = item("one");
        const two = item("two");
        store.subscribe(() => undefined);
        store.itemsRequest([one, two]);
        await settled();
        expect(reads).toHaveLength(2);
        reads[0]!.respond(asking("one", "One's lead-in."));
        await settled();
        expect(store.get().has(one.id)).toBe(true);

        // Both answered: neither is on screen any more.
        store.itemsRequest([]);
        expect(reads[1]!.signal?.aborted).toBe(true);
        // Forgotten after the call, not in it.
        expect(store.get().has(one.id)).toBe(true);
        await settled();
        expect(store.get().size).toBe(0);
    });

    it("reads at most four questions at a time", async () => {
        const { reads, store } = storeCreate();
        const items = ["a", "b", "c", "d", "e", "f"].map((id) => item(id));
        store.subscribe(() => undefined);
        store.itemsRequest(items);
        await settled();
        expect(reads).toHaveLength(4);

        reads[0]!.respond(asking("a", "A."));
        await settled();
        expect(reads).toHaveLength(5);
        expect(reads[4]!.agentId).toBe("agent-e");
    });
});
