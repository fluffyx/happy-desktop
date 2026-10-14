import type {
    AgentMessage,
    HistoryRun,
    Message,
    MessageBlock,
    MessageHistoryQuery,
    MessageHistoryResponse,
    RunStatus,
    ServiceMessage,
    ToolCallBlock,
    UserMessage,
} from "@slopus/happy-agent-client";
import { afterEach, expect, it, vi } from "vitest";
import {
    HAPPY_AGENT_TRANSCRIPT_MESSAGE_LIMIT,
    HAPPY_AGENT_TRANSCRIPT_NAME_TIMEOUT_MS,
    HAPPY_AGENT_TRANSCRIPT_PAGE_LIMIT,
    happyAgentTranscriptFormat,
    happyAgentTranscriptAgentIds,
    happyAgentTranscriptAgentNamesRead,
    happyAgentTranscriptRunsRead,
    type HappyAgentTranscriptMode,
} from "./happyAgentTranscript.js";

const SELF = "agent_self";
const NAMES = new Map([["agent_coordinator", "Coordinator"]]);

let sequence = 0;
const nextId = (prefix: string) => `${prefix}_${String((sequence += 1))}`;

const run = (messages: Message[], status: RunStatus = "completed"): HistoryRun => ({
    id: nextId("run"),
    status,
    reason: status === "completed" ? "completed" : status === "failed" ? "error" : null,
    startedAt: 0,
    endedAt: status === "running" ? null : 1,
    usage: {} as HistoryRun["usage"],
    costUsd: null,
    messages,
});

const user = (
    content: string | MessageBlock[],
    metadata: UserMessage["metadata"] = {},
): UserMessage => ({
    id: nextId("msg"),
    role: "user",
    createdAt: 0,
    content: typeof content === "string" ? [text(content)] : content,
    metadata,
    status: "accepted",
    delivery: "queue",
    mode: {} as UserMessage["mode"],
    runId: null,
});

const agent = (content: MessageBlock[], metadata: AgentMessage["metadata"] = {}): AgentMessage => ({
    id: nextId("msg"),
    role: "agent",
    createdAt: 0,
    content,
    metadata,
});

const service = (content: MessageBlock[]): ServiceMessage => ({
    id: nextId("msg"),
    role: "service",
    createdAt: 0,
    content,
    metadata: {},
});

const text = (value: string): MessageBlock => ({ type: "text", text: value });
const thinking = (value: string): MessageBlock => ({ type: "reasoning", text: value });
const tool = (
    name: string,
    call: Partial<Omit<ToolCallBlock, "type" | "name" | "elevated" | "review">> = {},
): ToolCallBlock => ({
    type: "tool_call",
    id: nextId("call"),
    name,
    status: "completed",
    ...call,
});

const format = (runs: HistoryRun[], mode: HappyAgentTranscriptMode) =>
    happyAgentTranscriptFormat({ agentId: SELF, runs, agentName: (id) => NAMES.get(id) }, mode);

/** A short chat touching everything a transcript renders. */
function sampleChat(): HistoryRun[] {
    return [
        run([
            user("Why does `pnpm test` fail on main?"),
            agent([
                thinking("The test output will say."),
                text("I'll run the failing suite."),
                tool("exec_command", {
                    presentation: {
                        type: "exec_command",
                        command: "pnpm --dir packages/state test",
                        output: "FAIL src/two.test.ts\n  expected 2, received 3\n",
                    },
                }),
            ]),
            agent([
                tool("Read", {
                    arguments: { path: "src/two.ts" },
                    result: { content: "export const two = () => 3;" },
                }),
            ]),
            agent([
                text("`two()` returns 3. Fixing it."),
                tool("apply_patch", {
                    presentation: {
                        type: "file_diff",
                        files: [
                            { path: "src/two.ts", kind: "update", added: 1, deleted: 1, hunks: [] },
                        ],
                    },
                }),
            ]),
            agent([text("Fixed: `two()` returns 2 again and the suite passes.")]),
        ]),
        run([
            user([
                text("Show me what it looks like."),
                { type: "image", mimeType: "image/png", data: "" },
            ]),
            agent([
                tool("present_files", {
                    presentation: {
                        type: "media",
                        items: [
                            {
                                kind: "image",
                                name: "result.png",
                                mimeType: "image/png",
                                size: 1,
                                width: 1,
                                height: 1,
                                thumbhash: "",
                            },
                        ],
                    },
                }),
            ]),
            agent([text("Here it is.")]),
        ]),
        run([
            agent([text("Please also note it in the changelog.")], {
                senderAgentId: "agent_coordinator",
            }),
            agent([
                tool("request_user_input", {
                    arguments: { question: "Which release should list it?" },
                    result: { status: "answered", answer: "0.0.85" },
                }),
            ]),
            agent([
                tool("create_artifact", {
                    presentation: {
                        type: "artifact",
                        artifactId: "art_1",
                        version: 1,
                        artifactType: "markdown",
                        title: "Changelog 0.0.85",
                    },
                }),
                text("Added it under 0.0.85."),
            ]),
            service([
                {
                    type: "compaction",
                    status: "completed",
                    trigger: "automatic",
                    startedAt: 0,
                    completedAt: 1,
                    failureReason: null,
                    tokensBefore: 180_000,
                    tokensAfter: 20_000,
                },
            ]),
        ]),
        run(
            [
                user("Ship it."),
                agent([
                    tool("exec_command", {
                        status: "failed",
                        presentation: {
                            type: "exec_command",
                            command: "pnpm release",
                            output: "error: not on main",
                        },
                    }),
                ]),
                service([text("The provider is overloaded.")]),
            ],
            "failed",
        ),
    ];
}

it("copies a concise transcript: what was said, and each turn's answer", () => {
    expect(format(sampleChat(), "concise")).toBe(
        [
            "## User",
            "",
            "Why does `pnpm test` fail on main?",
            "",
            "## Assistant",
            "",
            "[3 messages elided]",
            "",
            "Fixed: `two()` returns 2 again and the suite passes.",
            "",
            "## User",
            "",
            "Show me what it looks like.",
            "",
            "[Image]",
            "",
            "## Assistant",
            "",
            "[1 message elided]",
            "",
            "[Image: result.png]",
            "",
            "Here it is.",
            "",
            "## Agent: Coordinator",
            "",
            "Please also note it in the changelog.",
            "",
            "## Assistant",
            "",
            "[1 message elided]",
            "",
            '    request_user_input: {"question":"Which release should list it?"}',
            '    ↳ {"status":"answered","answer":"0.0.85"}',
            "",
            "[Artifact: Changelog 0.0.85]",
            "",
            "Added it under 0.0.85.",
            "",
            "[1 message elided]",
            "",
            "## User",
            "",
            "Ship it.",
            "",
            "## Assistant",
            "",
            "[1 message elided]",
            "",
            "[Error: The provider is overloaded.]",
        ].join("\n"),
    );
});

it("copies a full transcript: every message and every call, with results under them", () => {
    expect(format(sampleChat(), "full")).toBe(
        [
            "## User",
            "",
            "Why does `pnpm test` fail on main?",
            "",
            "## Assistant",
            "",
            "I'll run the failing suite.",
            "",
            "    exec_command: pnpm --dir packages/state test",
            "    ↳ FAIL src/two.test.ts",
            "        expected 2, received 3",
            "",
            '    Read: {"path":"src/two.ts"}',
            '    ↳ {"content":"export const two = () => 3;"}',
            "",
            "`two()` returns 3. Fixing it.",
            "",
            "    apply_patch: src/two.ts",
            "    ↳ src/two.ts (+1 -1)",
            "",
            "Fixed: `two()` returns 2 again and the suite passes.",
            "",
            "## User",
            "",
            "Show me what it looks like.",
            "",
            "[Image]",
            "",
            "## Assistant",
            "",
            "    present_files",
            "    ↳ [Image: result.png]",
            "",
            "Here it is.",
            "",
            "## Agent: Coordinator",
            "",
            "Please also note it in the changelog.",
            "",
            "## Assistant",
            "",
            '    request_user_input: {"question":"Which release should list it?"}',
            '    ↳ {"status":"answered","answer":"0.0.85"}',
            "",
            "    create_artifact",
            "    ↳ [Artifact: Changelog 0.0.85]",
            "",
            "Added it under 0.0.85.",
            "",
            "[System: Context compacted (automatic)]",
            "",
            "## User",
            "",
            "Ship it.",
            "",
            "## Assistant",
            "",
            "    exec_command: pnpm release",
            "    ↳ Failed: error: not on main",
            "",
            "[Error: The provider is overloaded.]",
        ].join("\n"),
    );
});

it("copies nothing from a chat with nothing in it", () => {
    expect(format([], "concise")).toBe("");
    expect(format([], "full")).toBe("");
    // Thinking alone is not something said.
    expect(format([run([agent([thinking("Hmm.")])])], "full")).toBe("");
});

it("merges consecutive messages from one speaker under one heading", () => {
    const chat = [
        run([user("First."), agent([text("One.")])]),
        run([agent([text("Two.")]), user("Second."), user("Third.")]),
    ];
    expect(format(chat, "full")).toBe(
        "## User\n\nFirst.\n\n## Assistant\n\nOne.\n\nTwo.\n\n## User\n\nSecond.\n\nThird.",
    );
});

it("names another agent by what the window calls it, or by its id when it has no name", () => {
    const chat = [
        run([
            user("From the coordinator.", { senderAgentId: "agent_coordinator" }),
            agent([text("From a stranger.")], { senderAgentId: "agent_stranger" }),
            // A message this agent stamped as its own is its own output.
            agent([text("Mine.")], { senderAgentId: SELF }),
        ]),
    ];
    expect(format(chat, "full")).toBe(
        [
            "## Agent: Coordinator",
            "",
            "From the coordinator.",
            "",
            "## Agent: agent_stranger",
            "",
            "From a stranger.",
            "",
            "## Assistant",
            "",
            "Mine.",
        ].join("\n"),
    );
});

it("counts the tool calls inside a kept answer instead of showing them", () => {
    const chat = [
        run([
            user("Go."),
            agent([text("Looking."), tool("Read"), tool("Read"), text("Done."), tool("Bash")]),
        ]),
    ];
    expect(format(chat, "concise")).toBe(
        [
            "## User",
            "",
            "Go.",
            "",
            "## Assistant",
            "",
            "Looking.",
            "",
            "[2 tool calls elided]",
            "",
            "Done.",
            "",
            "[1 tool call elided]",
        ].join("\n"),
    );
});

it("elides every message of a turn that never answered in words", () => {
    const chat = [run([user("Go."), agent([tool("Bash")]), agent([tool("Bash")])], "aborted")];
    expect(format(chat, "concise")).toBe("## User\n\nGo.\n\n## Assistant\n\n[2 messages elided]");
});

it("cuts a kept message at the limit and says how much was left out", () => {
    const long = "a".repeat(HAPPY_AGENT_TRANSCRIPT_MESSAGE_LIMIT + 5);
    const copied = format([run([user(long)])], "concise");
    expect(copied).toBe(
        `## User\n\n${"a".repeat(HAPPY_AGENT_TRANSCRIPT_MESSAGE_LIMIT)}…\n\n[5 more characters truncated]`,
    );
    // Full keeps every word.
    expect(format([run([user(long)])], "full")).toBe(`## User\n\n${long}`);
});

it("puts a long call over an indented block, and cuts input and result to ten lines and 500 characters", () => {
    const output = Array.from({ length: 12 }, (_, index) => `line ${String(index + 1)}`).join("\n");
    const command = `echo ${"x".repeat(80)}`;
    const chat = [
        run([
            agent([
                tool("exec_command", {
                    presentation: { type: "exec_command", command, output },
                }),
                tool("Write", {
                    arguments: { content: "y".repeat(600) },
                }),
            ]),
        ]),
    ];
    const lines = format(chat, "full").split("\n");
    expect(lines.slice(0, 15)).toEqual([
        "## Assistant",
        "",
        "    exec_command:",
        `        ${command}`,
        "    ↳ line 1",
        ...Array.from({ length: 8 }, (_, index) => `      line ${String(index + 2)}`),
        "      line 10…",
        "    Write:",
    ]);
    const write = lines[15]!;
    expect(write.startsWith(`        {"content":"${"y".repeat(20)}`)).toBe(true);
    expect(write.length).toBe("        ".length + 500 + "…".length);
    expect(lines).toHaveLength(16);
});

it("says nothing after a call that is still running", () => {
    const chat = [
        run(
            [agent([tool("Bash", { status: "running", arguments: { cmd: "sleep 9" } })])],
            "running",
        ),
    ];
    expect(format(chat, "full")).toBe('## Assistant\n\n    Bash: {"cmd":"sleep 9"}');
});

it("names the agent a call created", () => {
    const chat = [
        run([
            agent([
                tool("create_agent", {
                    arguments: { prompt: "Check it." },
                    presentation: {
                        type: "agent_spawn",
                        agentId: "agent_coordinator",
                        model: { modelId: "m", providerId: "p", name: "Opus" },
                    },
                }),
            ]),
        ]),
    ];
    expect(format(chat, "full")).toBe(
        '## Assistant\n\n    create_agent: {"prompt":"Check it."}\n    ↳ Agent: Coordinator',
    );
});

it("reads every page, oldest first, asking for tool data only for a full copy", async () => {
    const oldest = run([user("One.")]);
    const middle = run([user("Two.")]);
    const newest = run([user("Three.")]);
    const pages = new Map<string | undefined, MessageHistoryResponse>([
        [undefined, { cursor: "c", hasMore: true, runs: [newest] }],
        [newest.id, { cursor: "c", hasMore: true, runs: [middle] }],
        [middle.id, { cursor: "c", hasMore: false, runs: [oldest] }],
    ]);
    const queries: MessageHistoryQuery[] = [];
    const client = {
        getMessages: (agentId: string, query: MessageHistoryQuery = {}) => {
            expect(agentId).toBe(SELF);
            queries.push(query);
            return Promise.resolve(pages.get(query.before)!);
        },
    };

    expect(await happyAgentTranscriptRunsRead(client, SELF, "full")).toEqual([
        oldest,
        middle,
        newest,
    ]);
    expect(queries).toEqual([
        { limit: HAPPY_AGENT_TRANSCRIPT_PAGE_LIMIT, omitToolData: false },
        { before: newest.id, limit: HAPPY_AGENT_TRANSCRIPT_PAGE_LIMIT, omitToolData: false },
        { before: middle.id, limit: HAPPY_AGENT_TRANSCRIPT_PAGE_LIMIT, omitToolData: false },
    ]);

    queries.length = 0;
    await happyAgentTranscriptRunsRead(client, SELF, "concise");
    expect(queries).toHaveLength(3);
    expect(queries.every((query) => query.omitToolData === true)).toBe(true);
});

it("stops at an empty page even if the host says there is more", async () => {
    let reads = 0;
    const client = {
        getMessages: () => {
            reads += 1;
            return Promise.resolve({ cursor: "c", hasMore: true, runs: [] });
        },
    };
    expect(await happyAgentTranscriptRunsRead(client, SELF, "full")).toEqual([]);
    expect(reads).toBe(1);
});

it("fails rather than asking forever when a page reaches no further back", async () => {
    const stuck = run([user("Again.")]);
    let reads = 0;
    const client = {
        getMessages: () => {
            reads += 1;
            return Promise.resolve({ cursor: "c", hasMore: true, runs: [stuck] });
        },
    };
    await expect(happyAgentTranscriptRunsRead(client, SELF, "full")).rejects.toThrow(
        "did not reach further back",
    );
    expect(reads).toBe(2);
});

it("cancels the page in flight once the copy is abandoned", async () => {
    const controller = new AbortController();
    let asked = 0;
    const client = {
        // A page that never arrives on its own: only its signal ends it, so the
        // read can only settle if the abandonment reaches the request itself.
        getMessages: (_agentId: string, _query: MessageHistoryQuery = {}, options = {}) => {
            asked += 1;
            const { signal } = options as { signal: AbortSignal };
            return new Promise<MessageHistoryResponse>((_resolve, reject) =>
                signal.addEventListener("abort", () => reject(signal.reason)),
            );
        },
    };
    const read = happyAgentTranscriptRunsRead(client, SELF, "full", controller.signal);
    controller.abort(new Error("Replaced by a newer copy."));
    await expect(read).rejects.toThrow("Replaced by a newer copy.");
    expect(asked).toBe(1);
});

it("shows what a background terminal runs above what was typed into it", () => {
    const chat = [
        run([
            agent([
                tool("write_stdin", {
                    presentation: {
                        type: "background_terminal_interaction",
                        command: "pnpm dev",
                        input: "q",
                        terminalId: "term_1",
                    },
                }),
            ]),
        ]),
    ];
    expect(format(chat, "full")).toBe(
        "## Assistant\n\n    write_stdin:\n        pnpm dev\n        q",
    );
});

it("lists the other agents a history names, for naming them before it is written", () => {
    const chat = [
        run([
            user("From the coordinator.", { senderAgentId: "agent_coordinator" }),
            agent([text("Mine.")], { senderAgentId: SELF }),
            agent([
                tool("create_agent", {
                    presentation: { type: "agent_spawn", agentId: "agent_child" },
                }),
                // Not yet created: nothing to name.
                tool("create_agent", { presentation: { type: "agent_spawn" } }),
            ]),
        ]),
    ];
    expect([...happyAgentTranscriptAgentIds(chat, SELF)]).toEqual([
        "agent_coordinator",
        "agent_child",
    ]);
});

afterEach(() => {
    vi.restoreAllMocks();
});

it("names an unlisted agent by the host's title, and leaves one the host refuses unnamed", async () => {
    const chat = [
        run([
            user("Listed.", { senderAgentId: "agent_coordinator" }),
            user("Described.", { senderAgentId: "agent_described" }),
            user("Refused.", { senderAgentId: "agent_refused" }),
        ]),
    ];
    const asked: string[] = [];
    const client = {
        getAgent: (agentId: string) => {
            asked.push(agentId);
            return agentId === "agent_described"
                ? Promise.resolve({ agent: { title: " Release notes " } })
                : Promise.reject(new Error("Not found."));
        },
    } as unknown as Parameters<typeof happyAgentTranscriptAgentNamesRead>[0];

    const names = await happyAgentTranscriptAgentNamesRead(client, chat, SELF, (id) =>
        NAMES.get(id),
    );
    expect(Object.fromEntries(names)).toEqual({
        agent_coordinator: "Coordinator",
        agent_described: "Release notes",
    });
    // A listed agent is never asked about.
    expect(asked).toEqual(["agent_described", "agent_refused"]);
});

it("gives up on a host slow to name an agent, keeping its id instead of holding the copy", async () => {
    // Stands in for the deadline, so the test decides when it passes.
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const chat = [run([user("Hello.", { senderAgentId: "agent_stalled" })])];
    const client = {
        // Never answers; only its signal ends it.
        getAgent: (_agentId: string, options: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) =>
                options.signal.addEventListener("abort", () => reject(options.signal.reason)),
            ),
    } as unknown as Parameters<typeof happyAgentTranscriptAgentNamesRead>[0];

    const reading = happyAgentTranscriptAgentNamesRead(client, chat, SELF, () => undefined);
    expect(timeout).toHaveBeenCalledWith(HAPPY_AGENT_TRANSCRIPT_NAME_TIMEOUT_MS);
    deadline.abort(new Error("Timed out."));
    const names = await reading;
    expect(names.size).toBe(0);
    expect(
        happyAgentTranscriptFormat(
            { agentId: SELF, runs: chat, agentName: (id) => names.get(id) },
            "full",
        ),
    ).toBe("## Agent: agent_stalled\n\nHello.");
});
