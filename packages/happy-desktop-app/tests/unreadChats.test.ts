import { expect, it } from "vitest";
import type {
    HappyAgentBot,
    HappyAgentBotId,
    HappyAgentBotSubtask,
    HappyAgentProjectGroup,
    HappyAgentProjectId,
    HappyAgentTask,
    HappyAgentTaskId,
    HappyAgentWorktreeGroup,
    HappyAgentWorktreeId,
} from "happy-desktop-state";
import type { AppHappyAgentEntry } from "../sources/AppHappyAgentView";
import { unreadChats, unreadChatTarget, type UnreadChat } from "../sources/unreadChats";

/* Go to next unread walks exactly the chats the sidebar marks unread: newest
 * first, with any agent stopped on a question ahead of the rest. Previous walks
 * the same groups oldest first. The chat on screen is never the answer. */

type Conversation = HappyAgentBot["conversation"];

const chat = (
    id: string,
    updatedAt: number,
    state: { readonly unread?: boolean; readonly question?: boolean } = {},
): Conversation => ({
    id,
    title: `Chat ${id}`,
    activity: state.question ? "awaitingInput" : "idle",
    updatedAt,
    ...(state.unread === false ? {} : { unread: true }),
    participants: [],
});

const subtask = (
    workspaceId: string,
    conversation: Conversation,
    subtasks: readonly HappyAgentBotSubtask[] = [],
): HappyAgentBotSubtask => ({
    workspaceId: workspaceId as HappyAgentWorktreeId,
    path: `/work/${workspaceId}`,
    conversation,
    subtasks,
});

const bot = (
    id: string,
    conversation: Conversation,
    subtasks: readonly HappyAgentBotSubtask[] = [],
): HappyAgentBot => ({
    id: id as HappyAgentBotId,
    workspaceId: `ws_${id}` as HappyAgentWorktreeId,
    conversation,
    subtasks,
    name: id,
    username: id,
    orderKey: id,
    path: `/Bots/${id}`,
    displayPath: `~/Bots/${id}`,
});

const task = (id: string, conversation: Conversation): HappyAgentTask => ({
    id: id as HappyAgentTaskId,
    workspaceId: `ws_${id}` as HappyAgentWorktreeId,
    name: id,
    conversation,
    subtasks: [],
    owner: null,
    path: `/Tasks/${id}`,
    displayPath: `~/Tasks/${id}`,
    createdAt: 1,
    archived: false,
    canArchive: true,
});

const worktree = (id: string, conversations: readonly Conversation[]): HappyAgentWorktreeGroup => ({
    id: id as HappyAgentWorktreeId,
    projectId: "prj_app" as HappyAgentProjectId,
    name: id,
    orderKey: id,
    path: `/app/${id}`,
    displayPath: `~/app/${id}`,
    lifecycle: { phase: "ready" },
    conversations,
    activity: "idle",
    updatedAt: 1,
});

const project = (
    conversations: readonly Conversation[],
    worktrees: readonly HappyAgentWorktreeGroup[] = [],
): HappyAgentProjectGroup => ({
    id: "prj_app" as HappyAgentProjectId,
    name: "app",
    orderKey: "a",
    path: "/app",
    displayPath: "~/app",
    kind: "regular",
    lifecycle: { phase: "ready" },
    conversations,
    worktrees,
    activity: "idle",
    updatedAt: 1,
});

const machine = (
    id: string,
    holds: {
        readonly bots?: readonly HappyAgentBot[];
        readonly tasks?: readonly HappyAgentTask[];
        readonly projects?: readonly HappyAgentProjectGroup[];
        readonly status?: AppHappyAgentEntry["status"];
    },
): AppHappyAgentEntry => ({
    id,
    label: id,
    status: holds.status ?? "connected",
    projects: holds.projects ?? [],
    bots: holds.bots ?? [],
    ...(holds.tasks ? { tasks: holds.tasks } : {}),
    projectsStatus: "ready",
});

const ids = (chats: readonly UnreadChat[]) => chats.map((entry) => entry.chatId);

it("lists every kind of unread chat the sidebar marks, newest first", () => {
    const chats = unreadChats(
        [
            machine("local", {
                bots: [bot("helper", chat("bot", 50), [subtask("ws_sub", chat("sub", 70))])],
                tasks: [task("launch", chat("task", 30))],
                projects: [
                    project(
                        [chat("root", 10), chat("read", 99, { unread: false })],
                        [worktree("ws_feature", [chat("feature", 60)])],
                    ),
                ],
            }),
        ],
        false,
    );
    expect(ids(chats)).toEqual(["sub", "feature", "bot", "task", "root"]);
    expect(chats.find((entry) => entry.chatId === "sub")).toEqual({
        happyAgentId: "local",
        groupId: "ws_sub",
        chatId: "sub",
        title: "Chat sub",
        question: false,
        updatedAt: 70,
    });
    expect(chats.find((entry) => entry.chatId === "feature")?.groupId).toBe("ws_feature");
    expect(chats.find((entry) => entry.chatId === "root")?.groupId).toBe("prj_app");
    expect(chats.find((entry) => entry.chatId === "bot")?.groupId).toBe("ws_helper");
});

it("puts chats stopped on a question first, then the rest newest first", () => {
    const chats = unreadChats(
        [
            machine("local", {
                projects: [
                    project([
                        chat("old-question", 10, { question: true }),
                        chat("newest", 90),
                        chat("new-question", 40, { question: true }),
                        chat("middle", 50),
                    ]),
                ],
            }),
        ],
        false,
    );
    expect(ids(chats)).toEqual(["new-question", "old-question", "newest", "middle"]);
});

it("leaves out a chat that is waiting on a question but has already been read", () => {
    const chats = unreadChats(
        [
            machine("local", {
                projects: [project([chat("seen", 90, { unread: false, question: true })])],
            }),
        ],
        false,
    );
    expect(chats).toEqual([]);
});

it("reads every connected machine together, and none that is offline", () => {
    const chats = unreadChats(
        [
            machine("local", { bots: [bot("a", chat("local-chat", 20))] }),
            machine("remote", { bots: [bot("b", chat("remote-chat", 30))] }),
            machine("offline", {
                status: "disconnected",
                bots: [bot("c", chat("offline-chat", 99))],
            }),
        ],
        false,
    );
    expect(chats.map((entry) => `${entry.happyAgentId}/${entry.chatId}`)).toEqual([
        "remote/remote-chat",
        "local/local-chat",
    ]);
});

it("leaves the Projects section out when the reader hid it, and keeps bots and tasks", () => {
    const local = machine("local", {
        bots: [bot("helper", chat("bot", 10))],
        tasks: [task("launch", chat("task", 20))],
        projects: [project([chat("root", 30)], [worktree("ws_feature", [chat("feature", 40)])])],
    });
    expect(ids(unreadChats([local], true))).toEqual(["task", "bot"]);
});

it("counts a subtask's worktree once, as the subtask's own chat", () => {
    const chats = unreadChats(
        [
            machine("local", {
                bots: [
                    bot("helper", chat("bot", 1, { unread: false }), [
                        subtask("ws_owned", chat("sub", 20)),
                    ]),
                ],
                projects: [
                    project([], [worktree("ws_owned", [chat("sub", 20), chat("sibling", 30)])]),
                ],
            }),
        ],
        false,
    );
    // The sidebar lists that worktree as the subtask, which wears only its own
    // chat's dot, so a sibling chat there is not something it shows as unread.
    expect(ids(chats)).toEqual(["sub"]);
    expect(chats[0]?.groupId).toBe("ws_owned");
});

it("opens the newest for Next and the oldest for Previous, never the chat on screen", () => {
    const chats = unreadChats(
        [machine("local", { projects: [project([chat("a", 30), chat("b", 20), chat("c", 10)])] })],
        false,
    );
    expect(unreadChatTarget(chats, "next", { happyAgentId: "local" })?.chatId).toBe("a");
    expect(unreadChatTarget(chats, "previous", { happyAgentId: "local" })?.chatId).toBe("c");
    expect(unreadChatTarget(chats, "next", { happyAgentId: "local", chatId: "a" })?.chatId).toBe(
        "b",
    );
    expect(
        unreadChatTarget(chats, "previous", { happyAgentId: "local", chatId: "c" })?.chatId,
    ).toBe("b");
    // The same id on another machine is a different chat.
    expect(unreadChatTarget(chats, "next", { happyAgentId: "remote", chatId: "a" })?.chatId).toBe(
        "a",
    );
});

it("keeps questions first for Previous too, oldest question first", () => {
    const chats = unreadChats(
        [
            machine("local", {
                projects: [
                    project([
                        chat("plain-old", 1),
                        chat("question-old", 10, { question: true }),
                        chat("question-new", 20, { question: true }),
                    ]),
                ],
            }),
        ],
        false,
    );
    expect(unreadChatTarget(chats, "previous", { happyAgentId: "local" })?.chatId).toBe(
        "question-old",
    );
    expect(
        unreadChatTarget(chats, "previous", { happyAgentId: "local", chatId: "question-old" })
            ?.chatId,
    ).toBe("question-new");
});

it("has nowhere to go when only the chat on screen is unread", () => {
    const chats = unreadChats(
        [machine("local", { projects: [project([chat("only", 1)])] })],
        false,
    );
    expect(unreadChatTarget(chats, "next", { happyAgentId: "local", chatId: "only" })).toBe(
        undefined,
    );
    expect(unreadChatTarget(chats, "previous", { happyAgentId: "local", chatId: "only" })).toBe(
        undefined,
    );
});
