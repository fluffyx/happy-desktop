import { useState } from "react";
import type { MessageDelivery, SendKey } from "happy-desktop-state";
import { expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import "./styles.css";
import { HappyAgentGeneralSettings } from "./pages/settings/HappyAgentGeneralSettings";
import { createRenderer } from "./testing";

/*
 * The Conversations section of General settings. "Send messages with" picks
 * the key that sends; its detail line names the key that writes a new line,
 * and the follow-up row's names the key that sends with the other delivery,
 * which moves to ⌥↵ once ⌘↵ is what sends.
 */

const noop = () => undefined;

function Harness(props: { sendKey: SendKey; followUp: MessageDelivery; testid: string }) {
    const [sendKey, setSendKey] = useState(props.sendKey);
    const [followUp, setFollowUp] = useState(props.followUp);
    return (
        <div
            data-testid={props.testid}
            style={{
                width: "720px",
                height: "400px",
                overflow: "auto",
                // The settings window's own type, which its shell would supply.
                fontFamily: "var(--happy-font-ui)",
            }}
        >
            <HappyAgentGeneralSettings
                appearance="system"
                effortOptions={[]}
                experimentalFeaturesEnabled={false}
                followUp={followUp}
                linkOpenPlacement="panel"
                modelOptions={[]}
                onAppearanceChange={noop}
                onDefaultModelChange={noop}
                onEffortChange={noop}
                onExperimentalFeaturesChange={noop}
                onFollowUpChange={setFollowUp}
                onLinkOpenPlacementChange={noop}
                onPermissionModeChange={noop}
                onScrollbarVisibilityChange={noop}
                onSendKeyChange={setSendKey}
                onTitleShimmerChange={noop}
                permissionMode="auto"
                permissionModeOptions={[]}
                scrollbarVisibility="automatic"
                sendKey={sendKey}
                titleShimmerEnabled={false}
            />
        </div>
    );
}

it("names the new-line key and the other-delivery key for the chosen send key", async () => {
    const view = createRenderer();
    view.render(() => <Harness followUp="steer" sendKey="enter" testid="enter" />, {
        width: 760,
        height: 440,
        padding: 20,
    });
    await view.ready();
    const root = view.$('[data-testid="enter"]').element as HTMLElement;
    const row = (label: string) =>
        Array.from(root.querySelectorAll<HTMLElement>('[data-happy-desktop-ui="form-row"]')).find(
            (candidate) => candidate.textContent?.includes(label),
        )!;
    const keysOf = (label: string) =>
        row(label)
            .querySelector(
                '[data-happy-desktop-ui="form-row-detail"] [data-happy-desktop-ui="key-cap"]',
            )
            ?.getAttribute("aria-label");
    const detailText = (label: string) =>
        row(label).querySelector('[data-happy-desktop-ui="form-row-detail"]')?.textContent;

    // Send on ↵: ⇧↵ writes a new line, ⌘↵ sends with the other delivery.
    const sendKey = row("Send messages with");
    expect(sendKey.querySelector('[aria-pressed="true"]')?.textContent).toBe("Enter");
    expect(keysOf("Send messages with")).toBe("⇧↵");
    expect(detailText("Send messages with")).toContain("for a new line");
    expect(keysOf("Follow-up behavior")).toBe("⌘↵");
    expect(detailText("Follow-up behavior")).toContain("to queue");

    // Send on ⌘↵: ↵ writes the new line, and ⌥↵ takes over the other delivery.
    await userEvent.click(sendKey.querySelector<HTMLElement>('[data-value="cmdEnter"]')!);
    expect(sendKey.querySelector('[aria-pressed="true"]')?.textContent).toBe("⌘ Enter");
    expect(keysOf("Send messages with")).toBe("↵");
    expect(keysOf("Follow-up behavior")).toBe("⌥↵");

    // The section sits in place: switching moved no row.
    const before = row("Follow-up behavior").getBoundingClientRect().top;
    await userEvent.click(sendKey.querySelector<HTMLElement>('[data-value="enter"]')!);
    expect(row("Follow-up behavior").getBoundingClientRect().top).toBe(before);
    await userEvent.click(sendKey.querySelector<HTMLElement>('[data-value="cmdEnter"]')!);

    // Bring the section to the top of the frame for the picture.
    root.scrollTop +=
        row("Send messages with").getBoundingClientRect().top -
        root.getBoundingClientRect().top -
        64;
    await view.screenshot("HappyAgentGeneralSettings.sendKey.test");
});
