import { afterEach, expect, it, vi } from "vitest";
import { connectHappyAgent } from "../happyAgentConnection/connectHappyAgent.js";
import type { HappyAgentConnection } from "../happyAgentConnection/types.js";
import { fakeHappyAgentDaemonCreate } from "../testing/fakeHappyAgentDaemon.js";
import { happyAgentChatStoreCreate, type HappyAgentChatOutput } from "./happyAgentChatStore.js";
import { happyAgentModelCatalogProject } from "./happyAgentProject.js";
import type { HappyAgentSessionId } from "./happyAgentTypes.js";

/* The delivery a send key chose reaches the wire unchanged, whether the reader
 * typed a message or a skill that is sent as one. */

const openConnections: HappyAgentConnection[] = [];

afterEach(() => {
    for (const connection of openConnections.splice(0)) connection.close();
});

async function chatOpen() {
    const daemon = fakeHappyAgentDaemonCreate();
    const project = daemon.projectSeed({ id: "project-a" });
    const agent = daemon.agentSeed(project.id, { id: "agent-a" });
    const connection = connectHappyAgent({
        endpoint: "http://happy-agent.test/",
        token: "token",
        client: daemon.client,
        wait: () => new Promise((resolve) => setTimeout(resolve, 0)),
        now: () => 1_000,
    });
    openConnections.push(connection);
    let groupsLive = false;
    connection.connectGroups({
        onChange: (_projects, state) => {
            groupsLive = state.connection === "live";
        },
        onError: () => undefined,
    });
    const outputs: HappyAgentChatOutput[] = [];
    const store = happyAgentChatStoreCreate(agent.id as HappyAgentSessionId, {
        catalog: happyAgentModelCatalogProject(daemon.configGet()),
        transcriptConnect: (options) => {
            const session = connection.connectSession({
                sessionId: options.sessionId,
                onChange: (elements, state) => options.onChange(elements, state, []),
                onError: options.onError,
            });
            return { close: () => session.close(), loadMore: (token) => session.loadMore(token) };
        },
        connectActions: connection,
        connectMutationSubscribe: () => () => undefined,
        output: (event) => outputs.push(event),
    });
    const unsubscribe = store.subscribe(() => undefined);
    await vi.waitFor(() => {
        expect(groupsLive).toBe(true);
        expect(store.get().session.type).toBe("ready");
    });
    const sent = () =>
        daemon.calls
            .filter((call) => call.method === "sendMessage")
            .map((call) => call.args[1] as { text: string; delivery: string; content?: unknown });
    return { daemon, agentId: agent.id, store, outputs, sent, unsubscribe };
}

it("sends a typed message with the delivery its key chose", async () => {
    const { store, outputs, sent, unsubscribe } = await chatOpen();
    await store.messageSend("after this, run the tests", [], "queue");
    await vi.waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]).toMatchObject({ text: "after this, run the tests", delivery: "queue" });
    expect(outputs).toContainEqual({
        type: "messageSent",
        sessionId: "agent-a",
        delivery: "queue",
    });
    unsubscribe();
});

it("sends a skill as a message carrying the same delivery", async () => {
    const { daemon, agentId, store, sent, unsubscribe } = await chatOpen();
    daemon.eventEmit("agent.slash_commands.updated", {
        agentId,
        slashCommands: [
            { name: "review", description: "Review the diff", hasArguments: true, kind: "skill" },
        ],
    });
    await vi.waitFor(() => expect(store.get().slashCommands).toHaveLength(1));
    await store.slashCommandInvoke("review", "the diff", "queue");
    await vi.waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]).toMatchObject({
        text: "/review the diff",
        delivery: "queue",
        content: [{ type: "tool_call_request", name: "read_skill", arguments: { name: "review" } }],
    });
    unsubscribe();
});
