// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { fakeHappyAgentDaemonCreate, type FakeHappyAgentDaemon } from "happy-desktop-state/testing";
import type {
    HappyAgentInboxItemId,
    HappyAgentProjectId,
    HappyAgentSessionId,
    happyAgentProtocol,
} from "happy-desktop-state";
import { happyAgentConnectionOpen, type HappyAgentConnectionHandle } from "./happyAgentConnection";

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
    subscriptions.push(inbox.subscribe(() => {}));
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
