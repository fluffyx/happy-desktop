import { expect, it } from "vitest";
import "./theme.css";
import "./styles/badge.css";
import "./styles/form-row.css";
import "./styles/segmented-control.css";
import { KeyCap } from "./Badge";
import { FormRow } from "./FormRow";
import { SegmentedControl } from "./SegmentedControl";
import { createRenderer } from "./testing";

const MUTED = "rgb(73, 69, 79)"; // --text-secondary

/*
 * The detail line is a third line of the row's text column: the description's
 * type and colour, 4px below it, 18px tall so a key cap sits inside it without
 * growing it. A row without one renders nothing for it.
 */
it("lays a detail line with a key cap 4px under the description", async () => {
    const control = (
        <SegmentedControl
            aria-label="Follow-up behavior"
            onChange={() => undefined}
            segments={[
                { value: "steer", label: "Steer" },
                { value: "queue", label: "Queue" },
            ]}
            size="small"
            value="steer"
        />
    );
    const view = createRenderer();
    view.render(
        () => (
            <div data-testid="detail">
                <FormRow
                    control={control}
                    description="Steer the agent mid-turn, or queue messages to send after it finishes"
                    detail={
                        <>
                            <span>Use</span>
                            <KeyCap keys="⌘↵" />
                            <span>to queue</span>
                        </>
                    }
                    label="Follow-up behavior"
                />
            </div>
        ),
        { width: 560, height: 120, padding: 20 },
    ).render(
        () => (
            <div data-testid="plain">
                <FormRow
                    control={control}
                    description="Steer the agent mid-turn, or queue messages to send after it finishes"
                    label="Follow-up behavior"
                />
            </div>
        ),
        { width: 560, height: 120, padding: 20 },
    );
    await view.ready();

    const part = (testid: string, name: string) =>
        view.container.querySelector(
            `[data-testid="${testid}"] [data-happy-desktop-ui="${name}"]`,
        ) as HTMLElement | null;
    const description = part("detail", "form-row-description")!.getBoundingClientRect();
    const detail = part("detail", "form-row-detail")!;
    const box = detail.getBoundingClientRect();
    const style = getComputedStyle(detail);
    expect(box.top - description.bottom).toBe(4);
    expect(box.height).toBe(18);
    expect(box.left).toBe(description.left);
    expect(style.display).toBe("flex");
    expect(style.columnGap).toBe("4px");
    expect(style.fontSize).toBe("12px");
    expect(style.lineHeight).toBe("16px");
    expect(style.color).toBe(MUTED);
    const cap = part("detail", "key-cap")!.getBoundingClientRect();
    expect(cap.height).toBe(18);
    expect(cap.top).toBe(box.top);
    // ⌘ is drawn rather than typed, so the cap names both keys for assistive tech.
    expect(part("detail", "key-cap")!.getAttribute("aria-label")).toBe("⌘↵");
    expect(detail.textContent).toBe("Use↵to queue");

    expect(part("plain", "form-row-detail")).toBeNull();
    // The detail line adds exactly its own height and gap to the row.
    const rowHeight = (testid: string) =>
        part(testid, "form-row")?.getBoundingClientRect().height ??
        (
            view.container.querySelector(`[data-testid="${testid}"] .happy-form-row`) as HTMLElement
        ).getBoundingClientRect().height;
    expect(rowHeight("detail") - rowHeight("plain")).toBe(22);

    await view.screenshot("FormRow.detail.test");
});
