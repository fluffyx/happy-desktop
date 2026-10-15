// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    fakeAgentMessage,
    fakeHappyAgentDaemonCreate,
    fakeRun,
    type FakeHappyAgentDaemon,
} from "happy-desktop-state/testing";
import {
    connectHappyAgent,
    happyAgentInboxStoreCreate,
    type HappyAgentInboxItemId,
    type HappyAgentProjectId,
    type HappyAgentSessionId,
    type happyAgentProtocol,
} from "happy-desktop-state";
import { happyAgentConnectionOpen, type HappyAgentConnectionHandle } from "./happyAgentConnection";
import { happyAgentInboxSourceCreate } from "./happyAgentInboxSource";

vi.mock("happy-desktop-app", () => ({ terminalDriverCreate: () => undefined }));
const handles: HappyAgentConnectionHandle[] = [];
const subscriptions: (() => void)[] = [];
afterEach(() => {
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
    for (const handle of handles.splice(0)) handle.dispose();
});

const AGENT_ID = "agent-asking";
const QUESTION_ID = "question-migration";
const ITEM_ID = `${AGENT_ID}/${QUESTION_ID}` as HappyAgentInboxItemId;

function questionCreate(daemon: FakeHappyAgentDaemon): happyAgentProtocol.Question {
    return {
        id: QUESTION_ID,
        agentId: AGENT_ID,
        runId: "run-migration",
        status: "pending",
        questions: [
            {
                id: "prompt-migration",
                header: "Migration",
                question: "How should the table be migrated?",
                multiSelect: false,
                options: [
                    { label: "All at once", description: "Move every row at once." },
                    { label: "Piecemeal", description: "Move a table at a time." },
                ],
            },
        ],
        autoResolveAt: null,
        answers: null,
        version: daemon.versionNext(),
        createdAt: 5,
        answeredAt: null,
    };
}

/**
 * Opens the desktop's real connection to a fake daemon with one agent that asks
 * and one that never does, and watches the inbox the way the sidebar count does.
 * `waiting` starts the asking agent already paused on its question, as a window
 * opened onto a machine with work blocked would find it.
 */
async function fixture(options: { readonly waiting?: boolean } = {}) {
    const daemon = fakeHappyAgentDaemonCreate();
    const project = daemon.projectSeed({ id: "project-inbox", name: "Inbox project" });
    const agent = daemon.agentSeed(project.id, {
        id: AGENT_ID,
        title: "Migration plan",
        ...(options.waiting ? { pendingQuestionId: QUESTION_ID } : {}),
    });
    if (options.waiting) daemon.questionSet(agent.id, questionCreate(daemon));
    daemon.agentSeed(project.id, { id: "agent-quiet", title: "Quiet work" });
    const handle = happyAgentConnectionOpen({
        client: daemon.client,
        cloudHost: {
            cloudAuthCallbackSubscribe: () => () => {},
            cloudAuthCallbackTake: async () => undefined,
            cloudAuthConfigurationGet: () => new Promise(() => {}),
            cloudAuthOpen: async () => {},
        },
        deps: {
            changed: () => {},
            conversationOpen: () => {},
            groupForget: () => {},
            subtasksForget: () => {},
            groupOpen: () => {},
        },
        happyAgentHttpUrl: "http://happy-agent.test",
        happyAgentId: "inbox-test",
        memberProfileRequired: true,
        host: { applicationMenuOpen: () => {}, directoryPick: async () => undefined },
        modelPreferencePersistence: { read: () => undefined, write: () => {} },
        terminalColorScheme: () => "light",
    });
    handles.push(handle);
    await vi.waitFor(() => expect(handle.get()).toBeDefined());
    const session = handle.get()!;
    const inbox = session.inbox;
    if (!inbox) throw new Error("expected the connection to offer an inbox");
    const inboxUnsubscribe = inbox.subscribe(() => {});
    subscriptions.push(inboxUnsubscribe);
    await vi.waitFor(() => expect(inbox.get().loading).toBe(false));

    const openChat = async () => {
        const workspace = session.workspace;
        subscriptions.push(workspace.subscribe(() => {}));
        workspace.conversationOpen(
            agent.id as HappyAgentSessionId,
            project.id as HappyAgentProjectId,
        );
        await vi.waitFor(() => {
            const conversation = workspace.get().conversation;
            expect(conversation.type === "ready" && conversation.value.ready).toBe(true);
        });
        return workspace;
    };
    return {
        ask: () => daemon.questionAsk(agent.id, questionCreate(daemon)),
        daemon,
        inbox,
        inboxUnsubscribe,
        leadIns: session.inboxLeadIns,
        openChat,
    };
}

it("shows a question, answers it from the inbox, and moves it to answered", async () => {
    const f = await fixture();
    expect(f.inbox.get().pending).toEqual([]);

    f.ask();
    await vi.waitFor(() => expect(f.inbox.get().pending).toHaveLength(1));
    const [item] = f.inbox.get().pending;
    expect(item).toMatchObject({
        id: ITEM_ID,
        sessionId: AGENT_ID,
        requestId: QUESTION_ID,
        scope: { kind: "project", projectId: "project-inbox" },
        sessionTitle: "Migration plan",
        status: "pending",
        createdAt: 5,
    });
    expect(item?.questions[0]?.options.map((option) => option.label)).toEqual([
        "All at once",
        "Piecemeal",
    ]);

    f.inbox.itemAnswer(ITEM_ID, { "prompt-migration": ["Piecemeal"] });

    await vi.waitFor(() => expect(f.inbox.get().pending).toEqual([]));
    await vi.waitFor(() => expect(f.inbox.get().answered).toHaveLength(1));
    expect(f.inbox.get().answered[0]).toMatchObject({
        id: ITEM_ID,
        status: "answered",
        answers: { "prompt-migration": ["Piecemeal"] },
    });
    const answer = f.daemon.calls.find((call) => call.method === "answerQuestion");
    expect(answer?.args.slice(0, 2)).toEqual([AGENT_ID, QUESTION_ID]);
    expect(answer?.args[2]).toMatchObject({ answers: { "prompt-migration": ["Piecemeal"] } });
});

it("lists a question that was already waiting when the window connected", async () => {
    const f = await fixture({ waiting: true });

    // Nothing announced it: the catalog's `pendingQuestionId` named it and the
    // inbox read it by id.
    await vi.waitFor(() => expect(f.inbox.get().pending.map((item) => item.id)).toEqual([ITEM_ID]));
    expect(f.daemon.calls.some((call) => call.method === "getPendingQuestion")).toBe(true);
});

it("clears a question answered in its own chat", async () => {
    const f = await fixture();
    const workspace = await f.openChat();

    f.ask();
    await vi.waitFor(() => expect(f.inbox.get().pending).toHaveLength(1));

    await workspace.answerInput({
        requestId: QUESTION_ID,
        answers: { "prompt-migration": ["All at once"] },
    });

    await vi.waitFor(() => expect(f.inbox.get().pending).toEqual([]));
    await vi.waitFor(() =>
        expect(f.inbox.get().answered.map((answered) => answered.answers)).toEqual([
            { "prompt-migration": ["All at once"] },
        ]),
    );
    expect(f.daemon.callCount("answerQuestion")).toBe(1);
});

it("drops a question whose run was aborted without calling it answered", async () => {
    const f = await fixture();
    const workspace = await f.openChat();

    f.ask();
    await vi.waitFor(() => expect(f.inbox.get().pending).toHaveLength(1));

    await workspace.runAbort();

    await vi.waitFor(() => expect(f.daemon.callCount("abortAgent")).toBe(1));
    await vi.waitFor(() => expect(f.inbox.get().pending).toEqual([]));
    expect(f.inbox.get().answered).toEqual([]);
    expect(f.daemon.callCount("answerQuestion")).toBe(0);
});

it("keeps an answer that arrived while the question was still being read", async () => {
    const daemon = fakeHappyAgentDaemonCreate();
    const project = daemon.projectSeed({ id: "project-inbox" });
    daemon.agentSeed(project.id, { id: AGENT_ID, pendingQuestionId: QUESTION_ID });
    daemon.questionSet(AGENT_ID, questionCreate(daemon));
    const readRelease = daemon.pause("getPendingQuestion:respond");
    subscriptions.push(readRelease);
    const connection = connectHappyAgent({
        client: daemon.client,
        endpoint: "http://happy-agent.test/",
        token: "token",
    });
    subscriptions.push(() => connection.close());
    // The events the source has finished handling. A generator resumes after
    // `yield` only once its consumer asks for the next input, which is after
    // the consumer's loop body for this one has run.
    const handled: happyAgentProtocol.HappyAgentEvent["type"][] = [];
    const inbox = happyAgentInboxStoreCreate({
        source: happyAgentInboxSourceCreate(daemon.client, {
            connectGroups: (options) => connection.connectGroups(options),
            sync: {
                async *follow(options) {
                    for await (const input of connection.sync.follow(options)) {
                        yield input;
                        if (input.kind === "update" && input.update.kind === "event")
                            handled.push(input.update.event.type);
                    }
                },
            },
        }),
    });
    subscriptions.push(() => inbox[Symbol.dispose]());
    subscriptions.push(inbox.subscribe(() => {}));
    await vi.waitFor(() => expect(daemon.callCount("getPendingQuestion")).toBe(1));

    // Another client answers after the read captured the question pending but
    // before its response arrives, and the source handles the answer first.
    await daemon.client.answerQuestion(AGENT_ID, QUESTION_ID, {
        answers: { "prompt-migration": ["Piecemeal"] },
    });
    await vi.waitFor(() => expect(handled).toContain("question.updated"));
    expect(inbox.get().answered).toEqual([]);
    readRelease();

    await vi.waitFor(() =>
        expect(inbox.get().answered.map((item) => [item.id, item.answers])).toEqual([
            [ITEM_ID, { "prompt-migration": ["Piecemeal"] }],
        ]),
    );
    expect(inbox.get().pending).toEqual([]);
});

it("keeps the answered list when the inbox is followed again", async () => {
    const f = await fixture();
    f.ask();
    await vi.waitFor(() => expect(f.inbox.get().pending).toHaveLength(1));
    f.inbox.itemAnswer(ITEM_ID, { "prompt-migration": ["Piecemeal"] });
    await vi.waitFor(() => expect(f.inbox.get().answered).toHaveLength(1));

    // The sidebar stops following when experimental features are switched off
    // or another Happy Agent is addressed, and follows again on the way back.
    f.inboxUnsubscribe();
    // Following again delivers the source's first list in the same call.
    subscriptions.push(f.inbox.subscribe(() => {}));
    expect(f.inbox.get().answered.map((item) => item.id)).toEqual([ITEM_ID]);

    // And it is still there once the queue has changed under the new subscription.
    const later = { ...questionCreate(f.daemon), id: "question-later", agentId: "agent-quiet" };
    f.daemon.questionAsk("agent-quiet", later);
    await vi.waitFor(() =>
        expect(f.inbox.get().pending.map((item) => item.requestId)).toEqual(["question-later"]),
    );
    expect(f.inbox.get().answered.map((item) => item.id)).toEqual([ITEM_ID]);
});

it("shows what the agent said before asking, read only while the inbox page follows it", async () => {
    const f = await fixture();
    f.daemon.historySet(AGENT_ID, [
        fakeRun({
            id: "run-migration",
            status: "running",
            messages: [
                fakeAgentMessage({
                    id: "message-lead-in",
                    content: [
                        { type: "reasoning", text: "Weighing the lock time." },
                        {
                            type: "text",
                            text: "The permissions table holds **40 million** rows.",
                        },
                        {
                            type: "tool_call",
                            id: QUESTION_ID,
                            name: "request_user_input",
                            status: "running",
                            arguments: {},
                        } as never,
                    ],
                }),
            ],
        }),
    ]);
    f.ask();
    await vi.waitFor(() => expect(f.inbox.get().pending).toHaveLength(1));
    // The sidebar's subscription reads no transcripts.
    expect(f.daemon.callCount("getMessages")).toBe(0);

    subscriptions.push(f.leadIns.subscribe(() => {}));
    f.leadIns.itemsRequest(f.inbox.get().pending);

    await vi.waitFor(() =>
        expect(f.leadIns.get().get(ITEM_ID)).toEqual({
            type: "ready",
            text: "The permissions table holds **40 million** rows.",
        }),
    );
    expect(f.daemon.calls.find((call) => call.method === "getMessages")?.args[0]).toBe(AGENT_ID);
});
