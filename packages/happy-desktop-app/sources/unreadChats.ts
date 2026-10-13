import type { HappyAgentBot, HappyAgentBotSubtask } from "happy-desktop-state";
import { happyAgentBotSubtasks } from "happy-desktop-state";
import type { AppHappyAgentEntry } from "./AppHappyAgentView";

/**
 * The chats waiting to be read, in the order Go to next unread visits them.
 *
 * Nothing here is stored. The list is the sidebar's own unread dots read back
 * out of the same snapshots, so the chord can never go somewhere the sidebar
 * shows no dot, nor pass over a dot it shows. Opening a chat is what marks it
 * read, so the chord walks the list without keeping a place in it: the chat it
 * just opened drops out, and pressing again goes to the next one.
 */

/** One unread chat, addressed the way its sidebar row opens it. */
export interface UnreadChat {
    readonly happyAgentId: string;
    readonly groupId: string;
    readonly chatId: string;
    readonly title: string;
    /** The agent is stopped on a question only the person can answer. */
    readonly question: boolean;
    /** Epoch milliseconds of the chat's newest content. */
    readonly updatedAt: number;
}

type Conversation = HappyAgentBot["conversation"];

/**
 * Every unread chat the sidebar marks, across every connected machine in the
 * window, newest first with the ones stopped on a question ahead of the rest.
 *
 * A folded project or bot still counts: folding is how the reader arranged the
 * list, not a request to stop hearing from it, and the Dock counts those chats
 * all the same. The Projects section the reader left out in settings does not:
 * it is not in the sidebar at all, so nothing there is offered.
 *
 * A machine that is not connected is left out because reading a chat there
 * cannot be recorded. Its dot would stay, and the chord would keep coming back
 * to it.
 */
export function unreadChats(
    happyAgents: readonly AppHappyAgentEntry[],
    projectsHidden: boolean,
): UnreadChat[] {
    const chats: UnreadChat[] = [];
    const seen = new Set<string>();
    for (const happyAgent of happyAgents) {
        if (happyAgent.status !== "connected") continue;
        const push = (groupId: string, conversation: Conversation) => {
            const key = `${happyAgent.id}/${conversation.id}`;
            if (conversation.unread !== true || seen.has(key)) return;
            seen.add(key);
            chats.push({
                happyAgentId: happyAgent.id,
                groupId,
                chatId: conversation.id,
                title: conversation.title,
                question: conversation.activity === "awaitingInput",
                updatedAt: conversation.updatedAt,
            });
        };
        const subtasksPush = (subtasks: readonly HappyAgentBotSubtask[]) => {
            for (const subtask of happyAgentBotSubtasks([{ subtasks }]))
                push(subtask.workspaceId, subtask.conversation);
        };
        for (const bot of happyAgent.bots) {
            push(bot.workspaceId, bot.conversation);
            subtasksPush(bot.subtasks);
        }
        for (const task of happyAgent.tasks ?? []) {
            push(task.workspaceId, task.conversation);
            subtasksPush(task.subtasks);
        }
        if (projectsHidden) continue;
        // A worktree a subtask works in is listed as that subtask, not under its
        // project, so the sidebar marks only the subtask's own chat there.
        const subtaskWorkspaceIds = new Set(
            happyAgentBotSubtasks([...happyAgent.bots, ...(happyAgent.tasks ?? [])]).map(
                (subtask) => subtask.workspaceId,
            ),
        );
        for (const project of happyAgent.projects) {
            for (const conversation of project.conversations) push(project.id, conversation);
            for (const worktree of project.worktrees) {
                if (subtaskWorkspaceIds.has(worktree.id)) continue;
                for (const conversation of worktree.conversations) push(worktree.id, conversation);
            }
        }
    }
    return chats.sort(
        (left, right) =>
            Number(right.question) - Number(left.question) || right.updatedAt - left.updatedAt,
    );
}

/**
 * The chat the chord opens from where the reader is standing.
 *
 * Next is the newest unread chat, Previous the oldest. A chat stopped on a
 * question comes first either way, because an agent waiting on an answer is
 * doing nothing until it gets one. The chat on screen is never the answer: it
 * is already being read.
 */
export function unreadChatTarget(
    chats: readonly UnreadChat[],
    direction: "next" | "previous",
    current: { readonly happyAgentId: string; readonly chatId?: string },
): UnreadChat | undefined {
    const candidates = chats.filter(
        (chat) => chat.happyAgentId !== current.happyAgentId || chat.chatId !== current.chatId,
    );
    if (direction === "next") return candidates[0];
    const questions = candidates.filter((chat) => chat.question);
    return (questions.length > 0 ? questions : candidates).at(-1);
}
