import type {
    HappyAgentInboxItem,
    HappyAgentInboxItemId,
    HappyAgentSessionId,
} from "happy-desktop-state";
import { expect, it } from "vitest";
import "../../styles.css";
import { createRenderer } from "../../testing";
import { HappyAgentInboxPage } from "./HappyAgentInboxPage";

const item = (id: string): HappyAgentInboxItem => ({
    id: id as HappyAgentInboxItemId,
    sessionId: `session-${id}` as HappyAgentSessionId,
    requestId: `request-${id}`,
    sessionTitle: "Migrate the permission table",
    status: "pending",
    createdAt: 1,
    questions: [
        {
            id: "approach",
            header: "Approach",
            question: "How should the migration run?",
            multiSelect: false,
            required: true,
            options: [
                { label: "In one transaction", description: "Atomic, longer lock." },
                { label: "In batches", description: "Less contention, slower." },
            ],
        },
    ],
});

const SHORT = "The permissions table holds **40 million** rows.";
const LONG = Array.from(
    { length: 12 },
    (_, index) => `Paragraph ${index + 1} of what the agent found before asking.`,
).join("\n\n");

const leadIns: Readonly<Record<string, string>> = { short: SHORT, long: LONG };

it("sets the agent's lead-in between the session line and the question", async () => {
    const view = createRenderer().render(
        () => (
            <HappyAgentInboxPage
                answered={[]}
                data-testid="inbox"
                itemLeadIn={(candidate) => leadIns[candidate.id]}
                itemTime={() => "Asked 3m ago"}
                onAnswer={() => undefined}
                pending={[item("short"), item("long"), item("bare")]}
            />
        ),
        { width: 720, height: 1400 },
    );
    await view.ready();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const article = (id: string) =>
        view.$(`[data-happy-desktop-ui="happy-agent-inbox-item"][data-item-id="${id}"]`);
    const part = (id: string, selector: string) =>
        view.$(
            `[data-happy-desktop-ui="happy-agent-inbox-item"][data-item-id="${id}"] ${selector}`,
        );

    // A question with no lead-in is unchanged: the session line, then the question.
    expect(
        article("bare").element.querySelector('[data-testid="happy-agent-inbox-lead-in"]'),
    ).toBeNull();

    for (const id of ["short", "long"]) {
        const header = part(id, '[data-happy-desktop-ui="happy-agent-inbox-item-header"]');
        const leadIn = part(id, '[data-testid="happy-agent-inbox-lead-in"]');
        const prompt = part(id, '[data-happy-desktop-ui="happy-agent-user-input"]');
        // The card's own 12px rhythm separates all three.
        expect(leadIn.bounds().y).toBeCloseTo(header.bounds().y + header.bounds().height + 12, 2);
        expect(prompt.bounds().y).toBeCloseTo(leadIn.bounds().y + leadIn.bounds().height + 12, 2);
        expect(leadIn.bounds().x).toBe(header.bounds().x);
        expect(leadIn.bounds().width).toBe(header.bounds().width);

        const paragraph = part(id, '[data-happy-desktop-ui="happy-agent-inbox-lead-in-text"] p');
        expect(paragraph.computedStyle("font-size")).toBe("14px");
        expect(paragraph.computedStyle("line-height")).toBe("20px");
        // Secondary ink, the same the item's time is set in.
        const text = part(id, '[data-happy-desktop-ui="happy-agent-inbox-lead-in-text"]');
        expect(text.computedStyle("color")).toBe(
            part(id, ".happy-agent-inbox__item-time").computedStyle("color"),
        );
        const ink = await paragraph.visibleMetrics();
        expect(ink.pixelCount).toBeGreaterThan(0);
    }

    // The agent's Markdown is rendered, not shown as source.
    expect(part("short", "strong").element.textContent).toBe("40 million");

    // One paragraph fits; twelve are cut to seven lines with the way to the rest.
    expect(
        part("short", '[data-happy-desktop-ui="clamped-content"]').element.hasAttribute(
            "data-clipped",
        ),
    ).toBe(false);
    const longViewport = part("long", '[data-happy-desktop-ui="clamped-content-viewport"]');
    expect(longViewport.bounds().height).toBe(140);
    expect(part("long", ".happy-clamped-content__toggle").element.textContent).toBe("Show more");

    await view.screenshot("HappyAgentInboxPage.leadIn.test");
});
