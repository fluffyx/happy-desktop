import type {
    HappyAgentClient,
    HistoryRun,
    MediaItem,
    Message,
    MessageBlock,
    ToolCallBlock,
} from "@slopus/happy-agent-client";

/**
 * How much of a chat a copied transcript keeps. `concise` is each turn's words
 * and its answer, for handing a conversation to someone — or something — that
 * needs what was said rather than how the work went. `full` is every message
 * and every tool call, for reading the work back.
 */
export type HappyAgentTranscriptMode = "concise" | "full";

export interface HappyAgentTranscriptInput {
    /** The agent whose history this is: a message it stamped as its own is its own. */
    readonly agentId: string;
    /** Every run of the chat, oldest first, each with its messages oldest first. */
    readonly runs: readonly HistoryRun[];
    /** What the window calls another agent, for the heading over a message it sent. */
    readonly agentName: (agentId: string) => string | undefined;
}

/**
 * Messages asked for per page of a transcript read. A lower bound — the host
 * answers in whole runs — large enough that a long chat is a handful of reads.
 */
export const HAPPY_AGENT_TRANSCRIPT_PAGE_LIMIT = 500;
/** How long one page may take before the copy gives up rather than spinning on. */
const PAGE_TIMEOUT_MS = 60_000;

/**
 * Every run of one agent's history, oldest first, read from the host page by
 * page rather than taken from whatever an open chat has loaded so far. A
 * concise read leaves out the raw data of presented calls: the host drops it
 * only where a presentation stands in, and the presentation is all a concise
 * transcript shows of such a call.
 */
export async function happyAgentTranscriptRunsRead(
    client: Pick<HappyAgentClient, "getMessages">,
    agentId: string,
    mode: HappyAgentTranscriptMode,
): Promise<HistoryRun[]> {
    // Newest page first, each reaching further back, until the host says there
    // is nothing older. A page is whole runs, oldest first, so prepending each
    // keeps the history in order.
    const pages: (readonly HistoryRun[])[] = [];
    let before: string | undefined;
    for (;;) {
        const page = await client.getMessages(
            agentId,
            {
                ...(before === undefined ? {} : { before }),
                limit: HAPPY_AGENT_TRANSCRIPT_PAGE_LIMIT,
                omitToolData: mode === "concise",
            },
            { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) },
        );
        pages.unshift(page.runs);
        const oldest = page.runs[0];
        if (!page.hasMore || oldest === undefined) break;
        before = oldest.id;
    }
    return pages.flat();
}

/** A kept message longer than this is cut, so one pasted log cannot swamp a concise copy. */
export const HAPPY_AGENT_TRANSCRIPT_MESSAGE_LIMIT = 10_000;
/** A tool call's input and its result are each cut to this many lines… */
const TOOL_LINE_LIMIT = 10;
/** …and this many characters. */
const TOOL_CHARACTER_LIMIT = 500;
/** A tool call whose name and input fit in this many columns stays on one line. */
const TOOL_INLINE_WIDTH = 80;
const TOOL_INDENT = "    ";
const TOOL_BLOCK_INDENT = "        ";
const TOOL_RESULT_INDENT = "      ";

const USER = "User";
const ASSISTANT = "Assistant";

/**
 * A chat as Markdown, under `## User` and `## Assistant` headings with
 * consecutive messages from one speaker sharing a heading. Thinking is never
 * included, and neither is a title or any time: the transcript is what was
 * said, in order.
 *
 * A message another agent sent is headed with that agent's name, because it is
 * neither the reader's words nor this agent's. Notices — compaction, a failed
 * run — belong to the assistant's side of the conversation.
 *
 * Concise keeps, for each run, what the people and agents writing in said and
 * the one message that answered them: the last with text, or the error the run
 * ended on. Everything between is counted rather than shown. What the reader
 * was shown or asked in the conversation itself — a presented file, an
 * artifact, a question — is kept even from a message that is otherwise left
 * out, since it is part of what the conversation said.
 *
 * Empty when the chat has nothing to copy.
 */
export function happyAgentTranscriptFormat(
    input: HappyAgentTranscriptInput,
    mode: HappyAgentTranscriptMode,
): string {
    const transcript = transcriptCreate();
    for (const run of input.runs) {
        if (mode === "full") runFull(transcript, run, input);
        else runConcise(transcript, run, input);
    }
    return transcript.markdown();
}

interface Transcript {
    /** Adds one paragraph under a speaker, joining the section already open for it. */
    say(speaker: string, paragraph: string): void;
    markdown(): string;
}

function transcriptCreate(): Transcript {
    const sections: { speaker: string; paragraphs: string[] }[] = [];
    return {
        say(speaker, paragraph) {
            if (paragraph.length === 0) return;
            const last = sections.at(-1);
            if (last?.speaker === speaker) last.paragraphs.push(paragraph);
            else sections.push({ speaker, paragraphs: [paragraph] });
        },
        markdown: () =>
            sections
                .map((section) => `## ${section.speaker}\n\n${section.paragraphs.join("\n\n")}`)
                .join("\n\n"),
    };
}

/**
 * Who a message is from, as its heading names them. A message stamped with
 * another agent is that agent's whichever role it arrived in; one this agent
 * stamped itself is its own output.
 */
type Author =
    | { readonly kind: "writer"; readonly speaker: string }
    | { readonly kind: "assistant" }
    | { readonly kind: "notice" };

function authorOf(message: Message, input: HappyAgentTranscriptInput): Author {
    const sender = message.metadata.senderAgentId;
    if (message.role === "user") {
        return {
            kind: "writer",
            speaker: sender === undefined ? USER : agentSpeaker(sender, input),
        };
    }
    if (message.role === "agent") {
        return sender === undefined || sender === input.agentId
            ? { kind: "assistant" }
            : { kind: "writer", speaker: agentSpeaker(sender, input) };
    }
    return { kind: "notice" };
}

function agentSpeaker(agentId: string, input: HappyAgentTranscriptInput): string {
    return `Agent: ${input.agentName(agentId) ?? agentId}`;
}

function runFull(transcript: Transcript, run: HistoryRun, input: HappyAgentTranscriptInput): void {
    for (const message of run.messages) {
        const author = authorOf(message, input);
        if (author.kind === "writer") {
            transcript.say(author.speaker, writerText(message));
            continue;
        }
        for (const paragraph of messageParagraphs(message, run, input, "full"))
            transcript.say(ASSISTANT, paragraph);
    }
}

function runConcise(
    transcript: Transcript,
    run: HistoryRun,
    input: HappyAgentTranscriptInput,
): void {
    const authors = run.messages.map((message) => authorOf(message, input));
    // The answer is the last message that says something to the reader: text
    // from this agent, or the error that ended the run.
    let answer = -1;
    run.messages.forEach((message, index) => {
        const author = authors[index];
        if (
            (author?.kind === "assistant" && blocksHaveText(message.content)) ||
            (author?.kind === "notice" && runFailure(message, run) !== undefined)
        )
            answer = index;
    });
    let elided = 0;
    const elidedSay = (): void => {
        if (elided === 0) return;
        transcript.say(ASSISTANT, `[${countLabel(elided, "message")} elided]`);
        elided = 0;
    };
    run.messages.forEach((message, index) => {
        const author = authors[index]!;
        if (author.kind === "writer") {
            elidedSay();
            transcript.say(author.speaker, messageLimit(writerText(message)));
            return;
        }
        if (index === answer) {
            elidedSay();
            transcript.say(
                ASSISTANT,
                messageLimit(messageParagraphs(message, run, input, "concise").join("\n\n")),
            );
            return;
        }
        elided += 1;
        // What the reader was shown or asked survives the message around it.
        const kept = message.content.flatMap((block) =>
            block.type === "tool_call" && toolKept(block) ? [toolConcise(block, input)] : [],
        );
        if (kept.length === 0) return;
        elidedSay();
        for (const paragraph of kept) transcript.say(ASSISTANT, paragraph);
    });
    elidedSay();
}

/** A person's or another agent's message: its words, with a mark where a picture was. */
function writerText(message: Message): string {
    return message.content
        .flatMap((block): string[] => {
            switch (block.type) {
                case "text":
                    return block.text.length === 0 ? [] : [block.text];
                case "image":
                    return ["[Image]"];
                case "tool_call_request":
                    return [`[Tool request: ${block.name}]`];
                default:
                    return [];
            }
        })
        .join("\n\n");
}

/**
 * This agent's message or a notice, one paragraph per thing it says. A run of
 * tool calls is one paragraph, each call on its own lines, the way a terminal
 * shows a run of commands. In concise mode that run is a count instead, apart
 * from the calls whose result the reader saw.
 */
function messageParagraphs(
    message: Message,
    run: HistoryRun,
    input: HappyAgentTranscriptInput,
    mode: HappyAgentTranscriptMode,
): string[] {
    const paragraphs: string[] = [];
    let tools: string[] = [];
    let toolsElided = 0;
    const toolsSay = (): void => {
        if (toolsElided > 0) paragraphs.push(`[${countLabel(toolsElided, "tool call")} elided]`);
        if (tools.length > 0) paragraphs.push(tools.join("\n"));
        tools = [];
        toolsElided = 0;
    };
    const notice = message.role === "system" || message.role === "service";
    for (const block of message.content) {
        if (block.type === "tool_call") {
            if (mode === "full") tools.push(toolFull(block, input));
            else if (toolKept(block)) {
                toolsSay();
                paragraphs.push(toolConcise(block, input));
            } else toolsElided += 1;
            continue;
        }
        toolsSay();
        const paragraph = notice ? noticeText(block, message, run) : assistantText(block);
        if (paragraph !== undefined) paragraphs.push(paragraph);
    }
    toolsSay();
    return paragraphs;
}

function assistantText(block: MessageBlock): string | undefined {
    switch (block.type) {
        case "text":
            return block.text.length === 0 ? undefined : block.text;
        case "image":
            return "[Image]";
        case "compaction":
            return compactionText(block);
        default:
            return undefined;
    }
}

function noticeText(block: MessageBlock, message: Message, run: HistoryRun): string | undefined {
    if (block.type === "compaction") return compactionText(block);
    if (block.type !== "text" || block.text.length === 0) return undefined;
    return runFailure(message, run) !== undefined
        ? `[Error: ${block.text}]`
        : `[System: ${block.text}]`;
}

/** The failure a run ended on, which the host records as a service message's text. */
function runFailure(message: Message, run: HistoryRun): string | undefined {
    if (message.role !== "service" || run.status !== "failed") return undefined;
    const text = message.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n");
    return text.length === 0 ? undefined : text;
}

function compactionText(block: Extract<MessageBlock, { type: "compaction" }>): string {
    if (block.status === "failed")
        return `[System: Context compaction failed (${block.trigger}): ${block.failureReason}]`;
    if (block.status === "running") return `[System: Compacting context (${block.trigger})]`;
    return `[System: Context compacted (${block.trigger})]`;
}

function blocksHaveText(blocks: readonly MessageBlock[]): boolean {
    return blocks.some((block) => block.type === "text" && block.text.trim().length > 0);
}

/**
 * Whether a call is part of what the conversation said rather than how the
 * work was done: something presented to the reader, an artifact made for them,
 * or a question put to them. Concise keeps these.
 */
function toolKept(block: ToolCallBlock): boolean {
    return (
        block.presentation?.type === "media" ||
        block.presentation?.type === "artifact" ||
        block.name === "request_user_input"
    );
}

/**
 * A kept call in a concise transcript. What was presented is one line each;
 * a question is the call itself, input and answer, exactly as the full
 * transcript shows it — the host records it as an ordinary tool call, and
 * reading its private shape back out would be guessing at a contract nobody
 * gave us.
 */
function toolConcise(block: ToolCallBlock, input: HappyAgentTranscriptInput): string {
    const presented = presentedLines(block);
    // TODO: A `request_user_input` call is copied raw — its arguments and result
    // as JSON. It should read as text instead: the question, its options, and
    // the reader's answer. That needs Happy Agent to give questions a typed
    // presentation, so this can render that rather than parse the raw call.
    return presented === undefined ? toolFull(block, input) : presented;
}

function presentedLines(block: ToolCallBlock): string | undefined {
    const presentation = block.presentation;
    if (presentation?.type === "media") return presentation.items.map(mediaLine).join("\n");
    if (presentation?.type === "artifact") return `[Artifact: ${presentation.title}]`;
    return undefined;
}

function mediaLine(item: MediaItem): string {
    switch (item.kind) {
        case "image":
            return `[Image: ${item.name}]`;
        case "video":
            return `[Video: ${item.name}]`;
        case "document":
            return `[Document: ${item.name}]`;
        default:
            return `[File: ${item.name}]`;
    }
}

/**
 * One call, indented under the message that made it: `Name: input` on one line
 * when it fits, otherwise the name over an indented block, then what came back
 * after `↳`. Both halves are cut to a few lines; the transcript says that the
 * call happened and roughly what it saw, not everything it read.
 */
function toolFull(block: ToolCallBlock, input: HappyAgentTranscriptInput): string {
    const lines: string[] = [];
    const subject = toolSubject(block);
    const head = `${TOOL_INDENT}${block.name}: ${subject}`;
    if (subject.length === 0) lines.push(`${TOOL_INDENT}${block.name}`);
    else if (!subject.includes("\n") && head.length <= TOOL_INLINE_WIDTH) lines.push(head);
    else {
        lines.push(`${TOOL_INDENT}${block.name}:`);
        for (const line of subject.split("\n")) lines.push(`${TOOL_BLOCK_INDENT}${line}`);
    }
    const outcome = toolOutcome(block, input);
    if (outcome !== undefined) {
        const [first, ...rest] = outcome.split("\n");
        lines.push(`${TOOL_INDENT}↳ ${first ?? ""}`);
        for (const line of rest) lines.push(`${TOOL_RESULT_INDENT}${line}`);
    }
    return lines.join("\n");
}

/** What a call was asked to do, from its typed presentation when it has one. */
function toolSubject(block: ToolCallBlock): string {
    const presentation = block.presentation;
    let subject: string;
    switch (presentation?.type) {
        case "exec_command":
            subject = presentation.command;
            break;
        case "background_terminal_interaction":
            subject = presentation.input;
            break;
        case "exploration":
            subject = presentation.operations
                .map((operation) =>
                    operation.kind === "list"
                        ? `list ${operation.target}`
                        : operation.kind === "read"
                          ? `read ${operation.name}`
                          : operation.command,
                )
                .join("\n");
            break;
        case "file_diff":
            subject = presentation.files.map((file) => file.path).join("\n");
            break;
        case "search":
            subject = presentation.query;
            break;
        default:
            subject =
                block.arguments === undefined || Object.keys(block.arguments).length === 0
                    ? ""
                    : JSON.stringify(block.arguments);
    }
    return toolClip(subject.replace(/\n+$/u, ""));
}

/** What a finished call came back with; nothing while it runs. */
function toolOutcome(block: ToolCallBlock, input: HappyAgentTranscriptInput): string | undefined {
    if (block.status === "running") return undefined;
    const presentation = block.presentation;
    let outcome: string | undefined;
    switch (presentation?.type) {
        case "exec_command":
            outcome = presentation.output ?? undefined;
            break;
        case "file_diff":
            outcome = [
                ...presentation.files.map(
                    (file) => `${file.path} (+${String(file.added)} -${String(file.deleted)})`,
                ),
                ...(presentation.omittedFiles === undefined || presentation.omittedFiles === 0
                    ? []
                    : [`${countLabel(presentation.omittedFiles, "more file")}`]),
            ].join("\n");
            break;
        case "search":
            outcome = presentation.sources
                ?.map((source) => `${source.title} ${source.url}`)
                .join("\n");
            break;
        case "agent_spawn":
            outcome =
                presentation.agentId === undefined
                    ? undefined
                    : `Agent: ${input.agentName(presentation.agentId) ?? presentation.agentId}`;
            break;
        case "media":
        case "artifact":
            outcome = presentedLines(block);
            break;
        default:
            outcome = block.result === undefined ? undefined : JSON.stringify(block.result);
    }
    if (block.status === "failed")
        outcome = outcome === undefined ? "Failed" : `Failed: ${outcome}`;
    if (outcome === undefined) return undefined;
    const trimmed = outcome.replace(/\n+$/u, "");
    return trimmed.length === 0 ? undefined : toolClip(trimmed);
}

function toolClip(text: string): string {
    const lines = text.split("\n");
    let clipped = lines.slice(0, TOOL_LINE_LIMIT).join("\n");
    let cut = lines.length > TOOL_LINE_LIMIT;
    if (clipped.length > TOOL_CHARACTER_LIMIT) {
        clipped = clipped.slice(0, TOOL_CHARACTER_LIMIT);
        cut = true;
    }
    return cut ? `${clipped}…` : clipped;
}

function messageLimit(text: string): string {
    if (text.length <= HAPPY_AGENT_TRANSCRIPT_MESSAGE_LIMIT) return text;
    const left = text.length - HAPPY_AGENT_TRANSCRIPT_MESSAGE_LIMIT;
    return `${text.slice(0, HAPPY_AGENT_TRANSCRIPT_MESSAGE_LIMIT)}…\n\n[${countLabel(left, "more character")} truncated]`;
}

function countLabel(count: number, noun: string): string {
    return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}
