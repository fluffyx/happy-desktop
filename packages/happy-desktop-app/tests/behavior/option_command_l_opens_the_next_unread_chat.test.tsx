import { act, fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type {
    HappyAgentBot,
    HappyAgentBotId,
    HappyAgentClockStore,
    HappyAgentConnectionStore,
    HappyAgentModelStore,
    HappyAgentPanelStore,
    HappyAgentProjectGroup,
    HappyAgentProjectId,
    HappyAgentWorkspaceStore,
    HappyAgentWorktreeId,
} from "happy-desktop-state";
import {
    appearanceStoreCreate,
    commandPaletteStoreCreate,
    happyAgentGroupAccessRefused,
    happyAgentHostNoop,
    happyAgentSidebarCollapseStoreCreate,
    HAPPY_AGENT_GROUP_UNLISTED_REFUSAL,
    projectsVisibilityStoreCreate,
} from "happy-desktop-state";
import {
    commandPaletteResults,
    commandPaletteSuggestionRows,
    COMMAND_PALETTE_PREVIEW_LIMIT,
    type CommandPaletteContext,
} from "../../sources/commandPaletteResults";
import {
    AppHappyAgentView,
    type AppHappyAgentDirectorySnapshot,
    type AppHappyAgentDirectoryStore,
    type AppHappyAgentEntry,
} from "../../sources/AppHappyAgentView";
import type { UnreadChat } from "../../sources/unreadChats";

/* Option-Command-L opens the newest unread chat anywhere in the window, with an
 * agent stopped on a question first; Shift-Option-Command-L opens the oldest.
 * Both reach chats inside a folded project, neither reaches into a Projects
 * section the reader hid, and the palette offers the same jump with its chord —
 * at the top of its suggestions, so the held-Command card shows it too. */

// jsdom lays nothing out, so the palette's keep-the-highlight-in-view call has
// nothing to do.
Element.prototype.scrollIntoView = () => undefined;

const CONNECTED = { connection: "connected", daemon: "ready", attempt: 0 } as const;
const PANEL_CLOSED = { open: false, tabs: [] } as const;
const MODELS_LOADING = { type: "loading" } as const;

type Conversation = HappyAgentBot["conversation"];

const conversation = (
    id: string,
    updatedAt: number,
    state: { readonly unread?: boolean; readonly question?: boolean } = {},
): Conversation => ({
    id,
    title: `Chat ${id}`,
    subtitle: "",
    updatedAt,
    activity: state.question ? "awaitingInput" : "idle",
    ...(state.unread === false ? {} : { unread: true }),
    participants: [],
});

const project = (
    conversations: readonly Conversation[],
    worktreeConversations: readonly Conversation[],
): HappyAgentProjectGroup => ({
    id: "prj_app" as HappyAgentProjectId,
    path: "/Users/happy/app",
    displayPath: "~/app",
    name: "app",
    orderKey: "a",
    kind: "regular",
    lifecycle: { phase: "ready" },
    worktrees: [
        {
            id: "ws_feature" as HappyAgentWorktreeId,
            projectId: "prj_app" as HappyAgentProjectId,
            name: "feature",
            orderKey: "a",
            path: "/Users/happy/app-feature",
            displayPath: "~/app-feature",
            lifecycle: { phase: "ready" },
            conversations: worktreeConversations,
            activity: "idle",
            updatedAt: 1,
        },
    ],
    activity: "idle",
    updatedAt: 1,
    conversations,
});

const bot = (conversation: Conversation): HappyAgentBot => ({
    id: "bot_helper" as HappyAgentBotId,
    workspaceId: "ws_helper" as HappyAgentWorktreeId,
    conversation,
    name: "Helper",
    username: "helper",
    orderKey: "a",
    path: "/Users/happy/Bots/helper",
    displayPath: "~/Bots/helper",
    subtasks: [],
});

function workspace(
    bots: readonly HappyAgentBot[],
    projects: readonly HappyAgentProjectGroup[],
): HappyAgentWorkspaceStore {
    const snapshot = {
        list: {
            bots,
            tasks: [],
            taskDirectory: [],
            tasksJoining: new Set(),
            taskFailures: new Map(),
            projects: { type: "ready" as const, value: projects },
            archivedSessions: [],
        },
        conversation: { type: "unloaded" as const },
        address: {},
        groupAccess: happyAgentGroupAccessRefused(HAPPY_AGENT_GROUP_UNLISTED_REFUSAL),
        fileTabs: [],
        tabOrder: [],
        openInTargets: [],
        fileViewMode: "unified" as const,
        fileScope: "changed" as const,
        fileLayout: "flat" as const,
        fileTreeExpanded: new Set<string>(),
        fileTreeCollapsed: new Set<string>(),
        fileSearch: { query: "", searching: false },
        workspaceFilesLoading: false,
        fileComments: { comments: [] },
        reviews: new Map(),
    };
    return {
        get: () => snapshot,
        panel: {
            get: () => PANEL_CLOSED,
            subscribe: () => () => undefined,
            [Symbol.dispose]: () => undefined,
        } as unknown as HappyAgentPanelStore,
        subscribe: () => () => undefined,
        deviceBridgeSupport: () => false,
        [Symbol.dispose]: () => undefined,
    } as unknown as HappyAgentWorkspaceStore;
}

function entry(
    id: string,
    holds: {
        readonly bots: readonly HappyAgentBot[];
        readonly projects: readonly HappyAgentProjectGroup[];
    },
): AppHappyAgentEntry {
    return {
        bots: holds.bots,
        tasks: [],
        version: "0.4.87-preview.5",
        id,
        label: id,
        projects: holds.projects,
        projectsStatus: "ready",
        session: {
            clock: {
                get: () => 1_764_000_000_000,
                subscribe: () => () => undefined,
                [Symbol.dispose]: () => undefined,
            } as unknown as HappyAgentClockStore,
            connection: {
                get: () => CONNECTED,
                subscribe: () => () => undefined,
                [Symbol.dispose]: () => undefined,
            } as unknown as HappyAgentConnectionStore,
            host: happyAgentHostNoop,
            models: {
                get: () => MODELS_LOADING,
                subscribe: () => () => undefined,
                [Symbol.dispose]: () => undefined,
            } as unknown as HappyAgentModelStore,
            workspace: workspace(holds.bots, holds.projects),
        },
        status: "connected",
    };
}

function view(
    holds: {
        readonly bots: readonly HappyAgentBot[];
        readonly projects: readonly HappyAgentProjectGroup[];
    },
    options: { readonly projectsHidden?: boolean; readonly folded?: readonly string[] } = {},
) {
    const onChatSelect = vi.fn();
    const snapshot: AppHappyAgentDirectorySnapshot = { happyAgents: [entry("local", holds)] };
    const directory: AppHappyAgentDirectoryStore = {
        get: () => snapshot,
        subscribe: () => () => undefined,
        happyAgentActivate: () => undefined,
    };
    const projectsVisibility = projectsVisibilityStoreCreate();
    projectsVisibility.projectsHiddenUpdate(options.projectsHidden === true);
    const sidebarCollapse = happyAgentSidebarCollapseStoreCreate();
    for (const row of options.folded ?? []) sidebarCollapse.rowCollapseToggle(row);
    const commandPalette = commandPaletteStoreCreate();
    const rendered = render(
        <AppHappyAgentView
            appearance={appearanceStoreCreate({ mode: "light" })}
            commandPalette={commandPalette}
            onChatSelect={onChatSelect}
            onFileClose={() => undefined}
            onFileSelect={() => undefined}
            onSettingsOpen={() => undefined}
            happyAgentId="local"
            happyAgents={directory}
            projectsVisibility={projectsVisibility}
            sidebarCollapse={sidebarCollapse}
        />,
    );
    return { ...rendered, onChatSelect, commandPalette };
}

// Option turns L into "¬" on a US layout, so the chord is matched on its key code.
const optionCommandL = () =>
    fireEvent.keyDown(window, { key: "¬", code: "KeyL", metaKey: true, altKey: true });
const shiftOptionCommandL = () =>
    fireEvent.keyDown(window, {
        key: "Ò",
        code: "KeyL",
        metaKey: true,
        altKey: true,
        shiftKey: true,
    });

it("opens the newest unread chat, and Shift opens the oldest", () => {
    const { onChatSelect } = view({
        bots: [bot(conversation("ses_bot", 30))],
        projects: [
            project(
                [conversation("ses_root", 10), conversation("ses_read", 99, { unread: false })],
                [conversation("ses_feature", 20)],
            ),
        ],
    });
    optionCommandL();
    expect(onChatSelect).toHaveBeenLastCalledWith("local", "ws_helper", "ses_bot");
    shiftOptionCommandL();
    expect(onChatSelect).toHaveBeenLastCalledWith("local", "prj_app", "ses_root");
    expect(onChatSelect).toHaveBeenCalledTimes(2);
});

it("opens a chat stopped on a question before newer unread ones", () => {
    const { onChatSelect } = view({
        bots: [bot(conversation("ses_bot", 90))],
        projects: [project([], [conversation("ses_question", 10, { question: true })])],
    });
    optionCommandL();
    expect(onChatSelect).toHaveBeenLastCalledWith("local", "ws_feature", "ses_question");
});

it("reaches an unread chat inside a folded project", () => {
    const { container, onChatSelect } = view(
        { bots: [], projects: [project([], [conversation("ses_feature", 20)])] },
        { folded: ["local/prj_app"] },
    );
    // The worktree's row is folded away under its project.
    expect(container.querySelector('[data-item-id="local/prj_app"]')).not.toBeNull();
    expect(container.querySelector('[data-item-id="local/ws_feature"]')).toBeNull();
    optionCommandL();
    expect(onChatSelect).toHaveBeenLastCalledWith("local", "ws_feature", "ses_feature");
});

it("leaves a hidden Projects section alone and still opens unread bots", () => {
    const { onChatSelect } = view(
        {
            bots: [bot(conversation("ses_bot", 10))],
            projects: [project([conversation("ses_root", 90)], [])],
        },
        { projectsHidden: true },
    );
    optionCommandL();
    expect(onChatSelect).toHaveBeenLastCalledWith("local", "ws_helper", "ses_bot");
});

it("does nothing when nothing is unread", () => {
    const { onChatSelect } = view({
        bots: [bot(conversation("ses_bot", 10, { unread: false }))],
        projects: [project([conversation("ses_root", 90, { unread: false })], [])],
    });
    optionCommandL();
    shiftOptionCommandL();
    expect(onChatSelect).not.toHaveBeenCalled();
});

it("opens a different unread chat on each press, then stands down once all are read", () => {
    const unread = new Set(["ses_bot", "ses_root", "ses_feature"]);
    const holds = () => ({
        bots: [bot(conversation("ses_bot", 30, { unread: unread.has("ses_bot") }))],
        projects: [
            project(
                [conversation("ses_root", 20, { unread: unread.has("ses_root") })],
                [conversation("ses_feature", 10, { unread: unread.has("ses_feature") })],
            ),
        ],
    });
    let snapshot: AppHappyAgentDirectorySnapshot = { happyAgents: [entry("local", holds())] };
    const listeners = new Set<() => void>();
    const directory: AppHappyAgentDirectoryStore = {
        get: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        happyAgentActivate: () => undefined,
    };
    const onChatSelect = vi.fn();
    const commandPalette = commandPaletteStoreCreate();
    const appearance = appearanceStoreCreate({ mode: "light" });
    const windowAt = (route: { readonly groupId?: string; readonly chatId?: string }) => (
        <AppHappyAgentView
            appearance={appearance}
            commandPalette={commandPalette}
            onChatSelect={onChatSelect}
            onFileClose={() => undefined}
            onFileSelect={() => undefined}
            onSettingsOpen={() => undefined}
            happyAgentId="local"
            happyAgents={directory}
            {...route}
        />
    );
    const { rerender } = render(windowAt({}));
    const opened: string[] = [];
    for (let press = 0; press < 3; press += 1) {
        optionCommandL();
        const [, groupId, chatId] = onChatSelect.mock.lastCall as [string, string, string];
        opened.push(chatId);
        // What the app does with that: the route names the chat, and reading
        // it clears its dot on the host, which the directory then publishes.
        unread.delete(chatId);
        act(() => {
            snapshot = { happyAgents: [entry("local", holds())] };
            for (const listener of listeners) listener();
        });
        rerender(windowAt({ groupId, chatId }));
    }
    expect(opened).toEqual(["ses_bot", "ses_root", "ses_feature"]);
    optionCommandL();
    shiftOptionCommandL();
    expect(onChatSelect).toHaveBeenCalledTimes(3);
    act(() => commandPalette.paletteOpen());
    expect(document.querySelector('[data-row-id="action:unread-next"]')).toBeNull();
});

it("offers Go to next unread at the top of the palette, naming the chat and wearing its chord", () => {
    const { commandPalette, onChatSelect } = view({
        bots: [bot(conversation("ses_bot", 30))],
        projects: [project([conversation("ses_root", 10)], [])],
    });
    act(() => commandPalette.paletteOpen());
    const rows = [
        ...document.querySelectorAll<HTMLElement>(
            '[data-happy-desktop-ui="command-palette-results-row"]',
        ),
    ];
    const first = rows[0]!;
    expect(first.getAttribute("data-row-id")).toBe("action:unread-next");
    expect(
        first.querySelector('[data-happy-desktop-ui="command-palette-results-title"]')?.textContent,
    ).toBe("Go to next unread");
    expect(
        first.querySelector('[data-happy-desktop-ui="command-palette-results-meta"]')?.textContent,
    ).toBe("Chat ses_bot");
    // The cap draws each modifier as its own symbol and spells the letter.
    expect(
        [...first.querySelectorAll('[data-happy-desktop-ui="key-cap-key"]')].map(
            (key) =>
                key.querySelector("[data-shortcut-symbol]")?.getAttribute("data-shortcut-symbol") ??
                key.textContent,
        ),
    ).toEqual(["⌥", "⌘", "L"]);
    fireEvent.click(first);
    expect(onChatSelect).toHaveBeenLastCalledWith("local", "ws_helper", "ses_bot");
});

const target = (chatId: string, question = false): UnreadChat => ({
    happyAgentId: "local",
    groupId: "prj_app",
    chatId,
    title: `Chat ${chatId}`,
    question,
    updatedAt: 1,
});

const CONTEXT: CommandPaletteContext = {
    archivedSessions: [],
    happyAgentId: "local",
    groupId: "prj_app",
    projects: [
        project(
            [1, 2, 3, 4, 5, 6].map((index) =>
                conversation(`ses_${index}`, index, { unread: false }),
            ),
            [],
        ),
    ],
    sessionCreateAvailable: true,
    tabs: [],
    tabStepAvailable: false,
    taskCreateAvailable: true,
    updateReady: { action: "restart", version: "1.2.3" },
    workspaceCreateAvailable: true,
};

it("keeps next unread within the held-Command card, however many recent chats there are", () => {
    const preview = commandPaletteSuggestionRows({
        ...CONTEXT,
        unread: { next: target("ses_new"), previous: target("ses_old") },
    }).slice(0, COMMAND_PALETTE_PREVIEW_LIMIT);
    expect(preview.map((row) => row.id).slice(0, 2)).toEqual([
        "action:update",
        "action:unread-next",
    ]);
    expect(preview.some((row) => row.id === "action:unread-previous")).toBe(false);
    expect(
        commandPaletteSuggestionRows(CONTEXT).some((row) => row.id.startsWith("action:unread")),
    ).toBe(false);
});

it("does not offer the next unread chat a second time among the recent ones", () => {
    const rows = commandPaletteSuggestionRows({
        ...CONTEXT,
        unread: { next: target("ses_6"), previous: target("ses_1") },
    });
    expect(
        rows
            .filter(
                (row) =>
                    row.kind === "command" &&
                    row.command.kind === "chatOpen" &&
                    row.command.chatId === "ses_6",
            )
            .map((row) => row.id),
    ).toEqual(["action:unread-next"]);
    // Every other recent chat is still offered.
    expect(rows.some((row) => row.id === "chat:ses_5")).toBe(true);
});

it("finds both jumps by typing, each with its own chord and its own chat", () => {
    const results = commandPaletteResults({
        ...CONTEXT,
        unread: { next: target("ses_new", true), previous: target("ses_old") },
        query: "unread",
        themeMode: "light",
        scrollbarVisibility: "automatic",
        linkOpenPlacement: "panel",
        titleShimmerEnabled: false,
        experimentalFeaturesEnabled: false,
    });
    const actions = results.sections.find((section) => section.id === "actions")?.rows ?? [];
    expect(actions).toMatchObject([
        {
            id: "action:unread-next",
            title: "Go to next unread",
            meta: "Chat ses_new",
            glyph: { kind: "icon", name: "question" },
            shortcut: { caps: "⌥⌘L" },
            command: { kind: "chatOpen", chatId: "ses_new", archived: false },
        },
        {
            id: "action:unread-previous",
            title: "Go to previous unread",
            meta: "Chat ses_old",
            glyph: { kind: "icon", name: "bell" },
            shortcut: { caps: "⌥⇧⌘L" },
            command: { kind: "chatOpen", chatId: "ses_old", archived: false },
        },
    ]);
});
