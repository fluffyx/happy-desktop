import { expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import "./theme.css";
import "./styles/clamped-content.css";
import { ClampedContent } from "./ClampedContent";
import { createRenderer } from "./testing";

/** Lines of fixed 20px type, so the content's natural height is known exactly. */
function Lines(props: { count: number }) {
    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                font: "14px/20px var(--happy-font-ui)",
            }}
        >
            {Array.from({ length: props.count }, (_, index) => (
                <span key={index} style={{ height: 20 }}>
                    Line {index + 1}
                </span>
            ))}
        </div>
    );
}

const COLLAPSED = 140;

function frame() {
    return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

it("cuts long content to its height with a fade and a toggle, and leaves short content alone", async () => {
    const view = createRenderer()
        .render(
            () => (
                <ClampedContent collapsedHeight={COLLAPSED} data-testid="clamped-short">
                    <Lines count={3} />
                </ClampedContent>
            ),
            { width: 320, height: 220, padding: 20 },
        )
        .render(
            () => (
                <ClampedContent collapsedHeight={COLLAPSED} data-testid="clamped-exact">
                    <Lines count={7} />
                </ClampedContent>
            ),
            { width: 320, height: 220, padding: 20 },
        )
        .render(
            () => (
                <ClampedContent collapsedHeight={COLLAPSED} data-testid="clamped-long">
                    <Lines count={20} />
                </ClampedContent>
            ),
            { width: 320, height: 240, padding: 20 },
        );
    await view.ready();
    await frame();

    // Content that fits is shown whole: no cut, no fade, nothing to press.
    for (const [testid, height] of [
        ["clamped-short", 60],
        ["clamped-exact", COLLAPSED],
    ] as const) {
        const root = view.$(`[data-testid="${testid}"]`);
        expect(root.element.hasAttribute("data-clipped")).toBe(false);
        expect(root.element.querySelector(".happy-clamped-content__toggle")).toBeNull();
        const viewport = view.$(
            `[data-testid="${testid}"] [data-happy-desktop-ui="clamped-content-viewport"]`,
        );
        expect(viewport.bounds()).toEqual({ x: 20, y: 20, width: 280, height });
        expect(viewport.computedStyle("mask-image")).toBe("none");
        expect(root.bounds().height).toBe(height);
    }

    const long = view.$('[data-testid="clamped-long"]');
    const viewport = view.$(
        '[data-testid="clamped-long"] [data-happy-desktop-ui="clamped-content-viewport"]',
    );
    const toggle = view.$('[data-testid="clamped-long"] .happy-clamped-content__toggle');
    expect(long.element.hasAttribute("data-clipped")).toBe(true);
    expect(long.computedStyle("display")).toBe("flex");
    expect(long.computedStyle("flex-direction")).toBe("column");
    expect(long.computedStyle("align-items")).toBe("flex-start");
    expect(long.computedStyle("row-gap")).toBe("4px");
    expect(viewport.bounds()).toEqual({ x: 20, y: 20, width: 280, height: COLLAPSED });
    expect(viewport.computedStyle("overflow-y")).toBe("hidden");
    expect(viewport.computedStyle("mask-image")).toContain("linear-gradient");
    // The toggle sits one 4px gap under the cut edge, at the block's left edge.
    expect(toggle.bounds().x).toBe(20);
    expect(toggle.bounds().y).toBe(20 + COLLAPSED + 4);
    expect(toggle.element.textContent).toBe("Show more");
    expect(toggle.element.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.element.getAttribute("aria-controls")).toBe(viewport.element.id);
    expect(viewport.element.id).not.toBe("");
    // A line of label type, not a padded button: its words start within a
    // glyph's side bearing of the content's own left edge.
    expect(toggle.bounds().height).toBe(20);
    expect(toggle.computedStyle("padding-left")).toBe("0px");
    expect(toggle.computedStyle("font-size")).toBe("12px");
    expect(toggle.computedStyle("font-weight")).toBe("600");
    expect(toggle.computedStyle("line-height")).toBe("20px");
    expect(toggle.computedStyle("background-color")).toBe("rgba(0, 0, 0, 0)");
    const ink = await toggle.visibleMetrics();
    expect(ink.pixelCount).toBeGreaterThan(0);
    expect(ink.bounds.x).toBeGreaterThanOrEqual(0);
    expect(ink.bounds.x).toBeLessThanOrEqual(1.5);

    await view.screenshot("ClampedContent.test");
});

it("grows to the whole content on Show more and back on Show less", async () => {
    const view = createRenderer().render(
        () => (
            <ClampedContent collapsedHeight={COLLAPSED} data-testid="clamped-toggle">
                <Lines count={20} />
            </ClampedContent>
        ),
        { width: 320, height: 520, padding: 20 },
    );
    await view.ready();
    await frame();
    const viewport = () =>
        view.$('[data-testid="clamped-toggle"] [data-happy-desktop-ui="clamped-content-viewport"]');
    const toggle = () => view.$('[data-testid="clamped-toggle"] .happy-clamped-content__toggle');

    // Exercising the same button node proves it is not remounted by its own press.
    const button = toggle().element;
    await userEvent.click(button);
    expect(toggle().element).toBe(button);
    expect(viewport().bounds().height).toBe(400);
    expect(viewport().computedStyle("mask-image")).toBe("none");
    expect(button.textContent).toBe("Show less");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(toggle().bounds().y).toBe(20 + 400 + 4);

    await userEvent.click(button);
    expect(viewport().bounds().height).toBe(COLLAPSED);
    expect(viewport().computedStyle("mask-image")).toContain("linear-gradient");
    expect(button.textContent).toBe("Show more");
    expect(button.getAttribute("aria-expanded")).toBe("false");
});

it("shows the rest when focus reaches something below the cut", async () => {
    const view = createRenderer().render(
        () => (
            <ClampedContent collapsedHeight={COLLAPSED} data-testid="clamped-focus">
                <a data-testid="link-above" href="#above" style={{ height: 20 }}>
                    Above the cut
                </a>
                <Lines count={12} />
                <a data-testid="link-below" href="#below" style={{ height: 20 }}>
                    Below the cut
                </a>
            </ClampedContent>
        ),
        { width: 320, height: 360, padding: 20 },
    );
    await view.ready();
    await frame();
    const root = view.$('[data-testid="clamped-focus"]');
    const viewport = view.$(
        '[data-testid="clamped-focus"] [data-happy-desktop-ui="clamped-content-viewport"]',
    );
    const toggle = root.element.querySelector(".happy-clamped-content__toggle");
    const above = view.$('[data-testid="link-above"]').element as HTMLElement;
    const below = view.$('[data-testid="link-below"]').element as HTMLElement;

    // Focus on what is already in view leaves the block as it is.
    above.focus();
    expect(document.activeElement).toBe(above);
    expect(root.element.hasAttribute("data-expanded")).toBe(false);
    expect(viewport.bounds().height).toBe(COLLAPSED);

    below.focus();
    expect(document.activeElement).toBe(below);
    expect(root.element.hasAttribute("data-expanded")).toBe(true);
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(viewport.bounds().height).toBe(20 + 12 * 20 + 20);
    expect(viewport.element.scrollTop).toBe(0);
    // The same nodes, so focus stays where the reader put it.
    expect(root.element.querySelector(".happy-clamped-content__toggle")).toBe(toggle);
});
