import { useState } from "react";
import type { MessageDelivery, SendKey } from "happy-desktop-state";
import { expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import "./theme.css";
import "./styles/badge.css";
import "./styles/button.css";
import "./styles/command-picker.css";
import "./styles/composer.css";
import "./styles/icon.css";
import "./styles/tooltip.css";
import "./styles/vector-icon.css";
import type { CommandPickerItem } from "./CommandPicker";
import { Composer } from "./Composer";
import { createRenderer } from "./testing";

/*
 * Sending on ⌘↵ leaves ↵, ⇧↵ and ⌃↵ to write new lines; ⌘↵ sends with the
 * follow-up behavior and ⌥↵ with the other one. While the agent works, the
 * send control names ⌥↵ as the other key, and holding ⌥ alone shows what it
 * would do.
 */

const agentsCommand: CommandPickerItem = {
    id: "agents",
    slash: "/agents",
    description: "Monitor delegated subagents",
    icon: "users",
};

function Harness(props: {
    sendKey: SendKey;
    followUp?: MessageDelivery;
    running?: boolean;
    pending?: boolean;
    initial?: string;
    sends: MessageDelivery[];
    commands?: string[];
    testid: string;
}) {
    const [value, setValue] = useState(props.initial ?? "");
    return (
        <div data-testid={props.testid} style={{ paddingTop: "48px" }}>
            <Composer
                commands={value.startsWith("/") ? [agentsCommand] : []}
                followUp={props.followUp}
                onCommandSelect={(id) => {
                    props.commands?.push(id);
                    setValue("");
                }}
                onSend={(delivery) => {
                    props.sends.push(delivery);
                }}
                onStop={() => undefined}
                onValueChange={setValue}
                pending={props.pending}
                running={props.running}
                sendKey={props.sendKey}
                value={value}
            />
        </div>
    );
}

it("writes new lines on ↵, ⇧↵ and ⌃↵, and sends on ⌘↵ and ⌥↵ when ⌘↵ sends", async () => {
    const sends: MessageDelivery[] = [];
    const queueSends: MessageDelivery[] = [];
    const commands: string[] = [];
    const view = createRenderer();
    view.render(() => <Harness sendKey="cmdEnter" sends={sends} testid="steer" />, {
        width: 600,
        height: 240,
        padding: 20,
    })
        .render(
            () => <Harness followUp="queue" sendKey="cmdEnter" sends={queueSends} testid="queue" />,
            { width: 600, height: 240, padding: 20 },
        )
        .render(
            () => <Harness commands={commands} sendKey="cmdEnter" sends={[]} testid="commands" />,
            { width: 600, height: 320, padding: 20 },
        );
    await view.ready();
    const textareaOf = (testid: string) =>
        view.$(`[data-testid="${testid}"] [data-happy-desktop-ui="composer-textarea"]`)
            .element as HTMLTextAreaElement;

    const steer = textareaOf("steer");
    await userEvent.click(steer);
    await userEvent.keyboard("First");
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("second");
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await userEvent.keyboard("third");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await userEvent.keyboard("fourth");
    expect(sends).toEqual([]);
    expect(steer.value).toBe("First\nsecond\nthird\nfourth");

    // ⌘↵ sends with the setting, ⌥↵ with the other one.
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await userEvent.keyboard("{Alt>}{Enter}{/Alt}");
    expect(sends).toEqual(["steer", "queue"]);
    expect(steer.value).toBe("First\nsecond\nthird\nfourth");

    const queue = textareaOf("queue");
    await userEvent.click(queue);
    await userEvent.keyboard("After this");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await userEvent.keyboard("{Alt>}{Enter}{/Alt}");
    expect(queueSends).toEqual(["queue", "steer"]);

    // An open command popover still takes a plain ↵: it picks the command.
    const command = textareaOf("commands");
    await userEvent.click(command);
    await userEvent.keyboard("/ag");
    await userEvent.keyboard("{Enter}");
    expect(commands).toEqual(["agents"]);
    expect(command.value).toBe("");
});

it("writes no ⌃↵ new line into a draft whose send is in flight", async () => {
    const values: string[] = [];
    const view = createRenderer();
    view.render(
        () => (
            <Composer
                onSend={() => undefined}
                onValueChange={(value) => values.push(value)}
                pending
                sendKey="cmdEnter"
                value="Being sent"
            />
        ),
        { width: 600, height: 200, padding: 20 },
    );
    await view.ready();
    const textarea = view.$('[data-happy-desktop-ui="composer-textarea"]')
        .element as HTMLTextAreaElement;
    textarea.focus();
    textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            key: "Enter",
        }),
    );
    expect(values).toEqual([]);
    expect(textarea.value).toBe("Being sent");
});

it("names ⌥↵ as the other key while the agent works, and ⌥ held shows what it does", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <Harness initial="Look again" running sendKey="cmdEnter" sends={[]} testid="running" />
        ),
        { width: 600, height: 200, padding: 20 },
    ).render(
        () => (
            <Harness
                followUp="queue"
                initial="After this"
                running
                sendKey="cmdEnter"
                sends={[]}
                testid="running-queue"
            />
        ),
        { width: 600, height: 200, padding: 20 },
    );
    await view.ready();
    const sendOf = (testid: string) =>
        view.$(`[data-testid="${testid}"] .happy-composer__send`).element as HTMLButtonElement;
    const tipOf = (testid: string) =>
        view.container.querySelector(
            `[data-testid="${testid}"] [data-happy-desktop-ui="tooltip"]`,
        ) as HTMLElement;

    expect(sendOf("running").getAttribute("aria-label")).toBe("Steer · ⌥↵ to queue");
    expect(sendOf("running-queue").getAttribute("aria-label")).toBe("Queue · ⌥↵ to steer");

    const textarea = view.$('[data-testid="running"] [data-happy-desktop-ui="composer-textarea"]')
        .element as HTMLTextAreaElement;
    await userEvent.click(textarea);

    // ⌘ is the send key here, so holding it shows nothing new.
    await userEvent.keyboard("{Meta>}");
    expect(sendOf("running").dataset.delivery).toBe("steer");
    expect(tipOf("running").hasAttribute("data-open")).toBe(false);
    await userEvent.keyboard("{/Meta}");

    await userEvent.keyboard("{Alt>}");
    expect(sendOf("running").getAttribute("aria-label")).toBe("Queue");
    expect(sendOf("running").dataset.delivery).toBe("queue");
    expect(tipOf("running").hasAttribute("data-open")).toBe(true);
    const bubble = tipOf("running").querySelector(".happy-tooltip__bubble") as HTMLElement;
    await expect.poll(() => getComputedStyle(bubble).opacity).toBe("1");
    await view.screenshot("Composer.sendKey.test");
    await userEvent.keyboard("{/Alt}");
    expect(sendOf("running").getAttribute("aria-label")).toBe("Steer · ⌥↵ to queue");
    expect(tipOf("running").hasAttribute("data-open")).toBe(false);
});
