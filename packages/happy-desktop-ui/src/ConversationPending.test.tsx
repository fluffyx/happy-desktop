import type {
    ComposerSnapshot,
    ConversationEntry,
    ConversationMessageEntry,
} from "happy-desktop-state";
import { expect, it } from "vitest";
import "./styles.css";
import { ConversationView, conversationPending } from "./ConversationView";
import { createRenderer } from "./testing";

/*
 * Messages the agent has not taken yet sit below the live status, grouped the
 * way it will take them — steering, then the queue — each under one caption
 * saying when. A queued bubble is drawn as not yet there, a dashed outline with
 * the exact geometry it has once taken.
 */

const composer: ComposerSnapshot = {
    agentUserIds: [],
    attachments: [],
    capabilities: { commands: [], mentions: false, shellMode: false },
    focused: false,
    mentionCandidates: [],
    revision: 0,
    scopeId: "pending",
    submission: { status: "idle" },
    text: "",
};

function own(
    id: string,
    text: string,
    delivery: ConversationMessageEntry["delivery"],
    pendingSend = false,
): ConversationMessageEntry {
    return {
        kind: "message",
        source: "server",
        delivery,
        ...(pendingSend ? { pendingSend } : {}),
        message: {
            id,
            chatId: "pending",
            sequence: id,
            changePts: id,
            sender: { id: "reader", displayName: "Casey", username: "casey", kind: "human" },
            text,
            attachments: [],
            reactions: [],
            createdAt: "2026-10-13T12:00:00.000Z",
        },
    };
}

const history: readonly ConversationEntry[] = [own("1", "Run the tests", "sent")];
const waiting: readonly ConversationEntry[] = [
    ...history,
    own("2", "Use the staging database", "pending_steering"),
    own("3", "Run the tests", "pending_queue"),
    own("4", "Then open a PR", "pending_queue"),
];

it("groups waiting messages as the agent will take them, and says when", () => {
    const running = conversationPending(waiting, true);
    expect(running.transcript).toEqual(history);
    expect(
        running.pending.map((group) => [
            group.delivery,
            group.caption,
            group.entries.map((entry) => (entry.kind === "message" ? entry.message.id : "")),
        ]),
    ).toEqual([
        ["steer", { label: "Steering", detail: "Read at the agent's next step" }, ["2"]],
        ["queue", { label: "Queued", detail: "Sends when the agent finishes" }, ["3", "4"]],
    ]);

    // Stopped: the host still holds them, and they go with the next message.
    expect(conversationPending(waiting, false).pending.map((group) => group.caption)).toEqual([
        { label: "Steering paused", detail: "Sends with your next message" },
        { label: "Queue paused", detail: "Resumes after your next message" },
    ]);

    // A send still in flight to an idle agent is about to start a run, not
    // waiting for one, so it gets no caption.
    const inFlight = conversationPending(
        [...history, own("5", "Hello", "pending_steering", true)],
        false,
    );
    expect(inFlight.pending).toHaveLength(1);
    expect(inFlight.pending[0]?.caption).toBeUndefined();
});

it("captions each group above its own bubbles and outlines a queued bubble at a sent bubble's size", async () => {
    const view = createRenderer();
    for (const [testid, running] of [
        ["running", true],
        ["paused", false],
    ] as const)
        view.render(
            () => (
                <div data-testid={testid} style={{ display: "flex", height: "100%" }}>
                    <ConversationView
                        composer={composer}
                        conversationId={testid}
                        entries={waiting}
                        onComposerSend={() => undefined}
                        onComposerValueChange={() => undefined}
                        running={running}
                        viewerId="reader"
                    />
                </div>
            ),
            { width: 720, height: 560, padding: 0 },
        );
    await view.ready();

    const root = (testid: string) => view.$(`[data-testid="${testid}"]`).element;
    const pending = (testid: string) =>
        root(testid).querySelector('[data-happy-desktop-ui="conversation-queued"]')!;
    const captions = (testid: string) =>
        Array.from(
            pending(testid).querySelectorAll(
                '[data-happy-desktop-ui="conversation-pending-caption"]',
            ),
        ) as HTMLElement[];

    // One caption per group, before its messages, in acceptance order.
    const order = Array.from(
        pending("running").querySelectorAll(
            '[data-happy-desktop-ui="conversation-pending-caption"], [data-happy-desktop-ui="message"]',
        ),
    ).map((element) =>
        element.matches('[data-happy-desktop-ui="conversation-pending-caption"]')
            ? `caption:${element.textContent}`
            : `message:${element.getAttribute("data-delivery-state")}`,
    );
    expect(order).toEqual([
        "caption:Steering·Read at the agent's next step",
        "message:pending_steering",
        "caption:Queued·Sends when the agent finishes",
        "message:pending_queue",
        "message:pending_queue",
    ]);
    expect(captions("paused").map((caption) => caption.textContent)).toEqual([
        "Steering paused·Sends with your next message",
        "Queue paused·Resumes after your next message",
    ]);

    // The caption is 24px, already true, so it is not held back like the
    // messages; its text ends on the own bubbles' right edge.
    const caption = captions("running")[1]!;
    const captionStyle = getComputedStyle(caption);
    expect(caption.getBoundingClientRect().height).toBe(24);
    expect(captionStyle.fontSize).toBe("12px");
    expect(captionStyle.lineHeight).toBe("16px");
    expect(captionStyle.opacity).toBe("1");
    const queued = Array.from(
        pending("running").querySelectorAll(
            '[data-delivery-state="pending_queue"] .happy-message__body',
        ),
    ) as HTMLElement[];
    const detail = caption.querySelector(".happy-conversation__pending-detail")!;
    expect(
        Math.abs(detail.getBoundingClientRect().right - queued[0]!.getBoundingClientRect().right),
    ).toBeLessThanOrEqual(0.5);
    const row = queued[0]!.closest('[data-happy-desktop-ui="message"]')!;
    expect(getComputedStyle(row.closest(".happy-conversation__pending-group > *")!).opacity).toBe(
        "0.62",
    );

    // Dashed, unfilled, and exactly the size the same words take once sent.
    const body = getComputedStyle(queued[0]!);
    expect(body.borderTopStyle).toBe("dashed");
    expect(body.borderTopWidth).toBe("1px");
    expect(body.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    const sent = root("running").querySelector(
        '[data-delivery-state="sent"] .happy-message__body',
    ) as HTMLElement;
    const sentBox = sent.getBoundingClientRect();
    const queuedBox = queued[0]!.getBoundingClientRect();
    expect([queuedBox.width, queuedBox.height]).toEqual([sentBox.width, sentBox.height]);
    expect(queuedBox.right).toBe(sentBox.right);

    await view.screenshot("ConversationPending.test");
});
