import {
    agentAuthor,
    happyAgentOwnerAuthor,
    type ComposerSnapshot,
    type ConversationEntry,
    type ConversationMessageEntry,
} from "happy-desktop-state";
import { ConversationView } from "../../src/ConversationView";
import { ComponentPage, DimensionRule, Specimen } from "../kit";
import { conversationEntries } from "./happyAgentChatFixtures";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-296";

const noop = () => undefined;

const COMPOSER: ComposerSnapshot = {
    agentUserIds: [],
    attachments: [],
    capabilities: { commands: [], mentions: false, shellMode: false },
    focused: false,
    mentionCandidates: [],
    revision: 0,
    scopeId: "conversation-pending",
    submission: { status: "idle" },
    text: "Also check the migration",
};

function waiting(
    id: string,
    text: string,
    delivery: ConversationMessageEntry["delivery"],
): ConversationMessageEntry {
    return {
        kind: "message",
        source: "server",
        delivery,
        message: {
            id,
            chatId: "conversation-pending",
            sequence: `9${id}`,
            changePts: id,
            sender: happyAgentOwnerAuthor,
            text,
            attachments: [],
            reactions: [],
            createdAt: "2026-10-13T12:00:00.000Z",
        },
    };
}

const PENDING: readonly ConversationEntry[] = [
    ...conversationEntries,
    waiting("1", "Use the staging database instead.", "pending_steering"),
    waiting("2", "After this, run the full test suite.", "pending_queue"),
    waiting("3", "Then open a PR.", "pending_queue"),
];

function Stage(props: { readonly running: boolean }) {
    return (
        <div
            style={{
                border: "1px solid var(--divider)",
                borderRadius: "8px",
                display: "flex",
                height: "560px",
                overflow: "hidden",
                width: "720px",
            }}
        >
            <ConversationView
                activityTreatment="focused"
                agentAuthor={agentAuthor}
                composer={COMPOSER}
                composerFollowUp="steer"
                conversationId={`conversation-pending-${String(props.running)}`}
                elapsedMs={42_000}
                entries={PENDING}
                motion="calm-typed"
                onAbort={noop}
                onComposerSend={noop}
                onComposerValueChange={noop}
                running={props.running}
                style={{ flex: "1 1 auto", minWidth: 0 }}
                viewerId={happyAgentOwnerAuthor.id}
                workingPhase="thinking"
            />
        </div>
    );
}

export function ConversationPendingPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="Messages the agent has not taken yet, below the live status in the order it takes them: steering at its next step, then the queue when the run finishes, each group under one caption. A stopped agent keeps them, and the captions say they go with the next message."
            title="Conversation pending messages"
        >
            <Specimen
                detail="running: Steering, then Queued; the send control names Steer and ⌘↵ queues"
                label="While the agent works"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <Stage running />
                    <DimensionRule label="24 px captions · rows held at 0.62 · 28 px right inset" />
                </div>
            </Specimen>

            <Specimen
                detail="stopped: both groups wait for the next message anyone sends"
                label="Paused after Stop"
                number="02"
                stage="surface"
            >
                <Stage running={false} />
            </Specimen>
        </ComponentPage>
    );
}
