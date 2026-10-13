import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HappyAgentWorkspaceClient } from "./happyAgentClient.js";
import type { HappyAgentSessionListSnapshot } from "./happyAgentSessionListStore.js";
import type { HappyAgentTranscriptMode } from "./happyAgentTranscript.js";
import type { HappyAgentSessionId } from "./happyAgentTypes.js";
import { happyAgentWorkspaceStoreCreate } from "./happyAgentWorkspaceStore.js";

/**
 * Copying a transcript returns at once and reports on the session's tab: the
 * copy running, then for a moment how it ended. A copy started over another
 * takes both the report and the clipboard; the one it replaced does neither.
 */

const SESSION = "ses_one" as HappyAgentSessionId;
const OTHER = "ses_two" as HappyAgentSessionId;

function inert(): unknown {
    return new Proxy(() => undefined, {
        get: (_target, property) =>
            property === "then"
                ? undefined
                : property === Symbol.iterator
                  ? function* () {}
                  : inert(),
        apply: () => undefined,
    });
}

interface Read {
    readonly sessionId: HappyAgentSessionId;
    readonly mode: HappyAgentTranscriptMode;
    resolve(text: string): void;
    reject(error: Error): void;
}

function store(clipboard?: (text: string) => Promise<void>) {
    const list = {
        projects: { type: "ready", value: [] },
        bots: [],
        botsCreating: [],
        archivedSessions: [],
        catalogRevision: 1,
        sessionCreateFailures: new Map(),
        worktreeCreateFailures: new Map(),
        projectCreateFailures: new Map(),
        subtaskFailures: new Map(),
        tasks: [],
        taskDirectory: [],
        tasksJoining: new Set(),
        taskFailures: new Map(),
    } as unknown as HappyAgentSessionListSnapshot;
    const reads: Read[] = [];
    const loading = { type: "loading" } as const;
    const client = new Proxy(
        {
            models: {
                get: () => loading,
                load: () => new Promise(() => undefined),
                subscribe: () => () => undefined,
            },
            sessionList: () =>
                new Proxy(
                    { get: () => list, subscribe: () => () => undefined },
                    {
                        get: (target, property) =>
                            property in target ? target[property as keyof typeof target] : inert(),
                    },
                ),
            chat: () => new Promise(() => undefined),
            openInTargetsRead: () => new Promise(() => undefined),
            workspaceFilesSubscribe: () => () => undefined,
            transcriptRead: (sessionId: HappyAgentSessionId, mode: HappyAgentTranscriptMode) =>
                new Promise<string>((resolve, reject) =>
                    reads.push({ sessionId, mode, resolve, reject }),
                ),
        } as Record<PropertyKey, unknown>,
        { get: (target, property) => (property in target ? target[property] : inert()) },
    ) as unknown as HappyAgentWorkspaceClient;
    const workspace = happyAgentWorkspaceStoreCreate(
        client,
        clipboard ? { clipboardWrite: clipboard } : {},
    );
    const unsubscribe = workspace.subscribe(() => undefined);
    return { workspace, reads, unsubscribe };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

it("reports the copy running, then copied for a moment, then nothing", async () => {
    const copied: string[] = [];
    const { workspace, reads, unsubscribe } = store((text) => {
        copied.push(text);
        return Promise.resolve();
    });

    workspace.transcriptCopy(SESSION, "concise");
    expect(workspace.get().transcriptCopy).toEqual({ sessionId: SESSION, status: "copying" });
    expect(reads.map(({ sessionId, mode }) => ({ sessionId, mode }))).toEqual([
        { sessionId: SESSION, mode: "concise" },
    ]);

    reads[0]!.resolve("## User\n\nHi.");
    await vi.advanceTimersByTimeAsync(0);
    expect(copied).toEqual(["## User\n\nHi."]);
    expect(workspace.get().transcriptCopy).toEqual({ sessionId: SESSION, status: "copied" });

    await vi.advanceTimersByTimeAsync(1_599);
    expect(workspace.get().transcriptCopy?.status).toBe("copied");
    await vi.advanceTimersByTimeAsync(1);
    expect(workspace.get().transcriptCopy).toBeUndefined();
    unsubscribe();
});

it("says there was nothing to copy, and leaves the clipboard alone", async () => {
    const clipboard = vi.fn(() => Promise.resolve());
    const { workspace, reads, unsubscribe } = store(clipboard);

    workspace.transcriptCopy(SESSION, "full");
    reads[0]!.resolve("");
    await vi.advanceTimersByTimeAsync(0);

    expect(workspace.get().transcriptCopy).toEqual({ sessionId: SESSION, status: "empty" });
    expect(clipboard).not.toHaveBeenCalled();
    unsubscribe();
});

it("fails when the host refuses the read, the clipboard refuses the text, or there is no clipboard", async () => {
    const refused = store(() => Promise.resolve());
    refused.workspace.transcriptCopy(SESSION, "full");
    refused.reads[0]!.reject(new Error("offline"));
    await vi.advanceTimersByTimeAsync(0);
    expect(refused.workspace.get().transcriptCopy).toEqual({
        sessionId: SESSION,
        status: "failed",
    });
    refused.unsubscribe();

    const rejected = store(() => Promise.reject(new Error("Document is not focused.")));
    rejected.workspace.transcriptCopy(SESSION, "full");
    rejected.reads[0]!.resolve("## User\n\nHi.");
    await vi.advanceTimersByTimeAsync(0);
    expect(rejected.workspace.get().transcriptCopy?.status).toBe("failed");
    rejected.unsubscribe();

    const absent = store();
    absent.workspace.transcriptCopy(SESSION, "full");
    absent.reads[0]!.resolve("## User\n\nHi.");
    await vi.advanceTimersByTimeAsync(0);
    expect(absent.workspace.get().transcriptCopy?.status).toBe("failed");
    absent.unsubscribe();
});

it("lets a newer copy take the clipboard and the report from one still running", async () => {
    const copied: string[] = [];
    const { workspace, reads, unsubscribe } = store((text) => {
        copied.push(text);
        return Promise.resolve();
    });

    workspace.transcriptCopy(SESSION, "full");
    workspace.transcriptCopy(OTHER, "concise");
    expect(workspace.get().transcriptCopy).toEqual({ sessionId: OTHER, status: "copying" });

    reads[1]!.resolve("other");
    await vi.advanceTimersByTimeAsync(0);
    // The first read lands last and is dropped whole.
    reads[0]!.resolve("first");
    await vi.advanceTimersByTimeAsync(0);
    expect(copied).toEqual(["other"]);
    expect(workspace.get().transcriptCopy).toEqual({ sessionId: OTHER, status: "copied" });
    unsubscribe();
});

it("keeps a new copy's report when an older one's moment runs out", async () => {
    const { workspace, reads, unsubscribe } = store(() => Promise.resolve());

    workspace.transcriptCopy(SESSION, "full");
    reads[0]!.resolve("first");
    await vi.advanceTimersByTimeAsync(1_000);
    workspace.transcriptCopy(OTHER, "full");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(workspace.get().transcriptCopy).toEqual({ sessionId: OTHER, status: "copying" });
    unsubscribe();
});
