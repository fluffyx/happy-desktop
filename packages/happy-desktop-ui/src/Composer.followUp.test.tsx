import { useState } from "react";
import type { MessageDelivery } from "happy-desktop-state";
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
 * ↵ sends with the follow-up behavior and ⌘↵ with the other one; ⇧↵ is a new
 * line. While the agent works, the send control names what it will do, and
 * holding ⌘ alone shows what ⌘↵ would do instead.
 */

const agentsCommand: CommandPickerItem = {
    id: "agents",
    slash: "/agents",
    description: "Monitor delegated subagents",
    icon: "users",
};

function Harness(props: {
    followUp?: MessageDelivery;
    running?: boolean;
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
                running={props.running}
                value={value}
            />
        </div>
    );
}

it("sends with the follow-up behavior on ↵ and the other one on ⌘↵", async () => {
    const steerSends: MessageDelivery[] = [];
    const queueSends: MessageDelivery[] = [];
    const commands: string[] = [];
    const commandSends: MessageDelivery[] = [];
    const view = createRenderer();
    view.render(() => <Harness sends={steerSends} testid="steer" />, {
        width: 600,
        height: 200,
        padding: 20,
    })
        .render(() => <Harness followUp="queue" sends={queueSends} testid="queue" />, {
            width: 600,
            height: 200,
            padding: 20,
        })
        .render(() => <Harness commands={commands} sends={commandSends} testid="commands" />, {
            width: 600,
            height: 320,
            padding: 20,
        });
    await view.ready();
    const textareaOf = (testid: string) =>
        view.$(`[data-testid="${testid}"] [data-happy-desktop-ui="composer-textarea"]`)
            .element as HTMLTextAreaElement;

    // Steer is the default: ↵ steers, ⌘↵ queues, and ⌃↵ and ⌥↵ keep sending
    // with the setting as they always have.
    const steer = textareaOf("steer");
    await userEvent.click(steer);
    await userEvent.keyboard("Look again");
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await userEvent.keyboard("{Alt>}{Enter}{/Alt}");
    expect(steerSends).toEqual(["steer", "queue", "steer", "steer"]);
    // ⇧↵ is a new line and sends nothing.
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    expect(steer.value).toBe("Look again\n");
    expect(steerSends).toHaveLength(4);

    // Queue swaps them.
    const queue = textareaOf("queue");
    await userEvent.click(queue);
    await userEvent.keyboard("After this");
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    expect(queueSends).toEqual(["queue", "steer"]);

    // An open command popover takes ↵ and ⌘↵ alike: they pick the command.
    const command = textareaOf("commands");
    await userEvent.click(command);
    await userEvent.keyboard("/ag");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    expect(commands).toEqual(["agents"]);
    expect(commandSends).toEqual([]);
});

it("never sends or picks a command from an Enter that commits an IME composition", async () => {
    const sends: MessageDelivery[] = [];
    const commands: string[] = [];
    const view = createRenderer();
    view.render(() => <Harness initial="にほん" sends={sends} testid="ime" />, {
        width: 600,
        height: 200,
        padding: 20,
    }).render(
        () => <Harness commands={commands} initial="/ag" sends={sends} testid="ime-command" />,
        { width: 600, height: 320, padding: 20 },
    );
    await view.ready();
    /*
     * Either signal marks the Enter as the composition's: `isComposing`, or the
     * legacy 229 keyCode some engines report once it is already false. The
     * constructor does not take a keyCode in every engine, so it is set on the
     * event itself.
     */
    const composingEnter = (metaKey: boolean, signal: "isComposing" | "keyCode") => {
        const event = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            isComposing: signal === "isComposing",
            key: "Enter",
            metaKey,
        });
        if (signal === "keyCode") Object.defineProperty(event, "keyCode", { value: 229 });
        return event;
    };
    for (const testid of ["ime", "ime-command"]) {
        const textarea = view.$(
            `[data-testid="${testid}"] [data-happy-desktop-ui="composer-textarea"]`,
        ).element as HTMLTextAreaElement;
        textarea.focus();
        for (const metaKey of [false, true])
            for (const signal of ["isComposing", "keyCode"] as const)
                textarea.dispatchEvent(composingEnter(metaKey, signal));
    }
    expect(sends).toEqual([]);
    // The open picker kept its highlight and picked nothing.
    expect(commands).toEqual([]);
    expect(
        view.container.querySelector('[data-testid="ime-command"] [data-happy-desktop-ui="composer-popover"]'),
    ).not.toBeNull();
});

it("names the follow-up on the send control while the agent works, and ⌘ held shows the other", async () => {
    const view = createRenderer();
    view.render(() => <Harness initial="Look again" sends={[]} testid="idle" />, {
        width: 600,
        height: 200,
        padding: 20,
    })
        .render(() => <Harness initial="Look again" running sends={[]} testid="running" />, {
            width: 600,
            height: 200,
            padding: 20,
        })
        .render(
            () => (
                <Harness
                    followUp="queue"
                    initial="After this"
                    running
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
        ) as HTMLElement | null;

    // An idle agent takes either delivery the same way, so the control is just Send.
    expect(sendOf("idle").getAttribute("aria-label")).toBe("Send message");
    expect(tipOf("idle")).toBeNull();
    expect(sendOf("idle").hasAttribute("data-delivery")).toBe(false);

    expect(sendOf("running").getAttribute("aria-label")).toBe("Steer · ⌘↵ to queue");
    expect(sendOf("running").dataset.delivery).toBe("steer");
    expect(tipOf("running")?.textContent).toContain("Steer · ⌘↵ to queue");
    expect(sendOf("running-queue").getAttribute("aria-label")).toBe("Queue · ⌘↵ to steer");

    // The tooltip wrapper adds no box: the control keeps the idle geometry.
    const idle = sendOf("idle").getBoundingClientRect();
    const running = sendOf("running").getBoundingClientRect();
    expect([running.width, running.height]).toEqual([32, 32]);
    expect([running.width, running.height]).toEqual([idle.width, idle.height]);
    expect(
        running.right - view.$('[data-testid="running"]').element.getBoundingClientRect().left,
    ).toBe(idle.right - view.$('[data-testid="idle"]').element.getBoundingClientRect().left);

    // Holding ⌘ alone in the draft shows what ⌘↵ would do.
    const textarea = view.$('[data-testid="running"] [data-happy-desktop-ui="composer-textarea"]')
        .element as HTMLTextAreaElement;
    await userEvent.click(textarea);
    await userEvent.keyboard("{Meta>}");
    expect(sendOf("running").getAttribute("aria-label")).toBe("Queue");
    expect(sendOf("running").dataset.delivery).toBe("queue");
    expect(tipOf("running")?.hasAttribute("data-open")).toBe(true);
    const bubble = tipOf("running")?.querySelector(".happy-tooltip__bubble") as HTMLElement;
    await expect.poll(() => getComputedStyle(bubble).opacity).toBe("1");
    await view.screenshot("Composer.followUp.test");
    await userEvent.keyboard("{/Meta}");
    expect(sendOf("running").getAttribute("aria-label")).toBe("Steer · ⌘↵ to queue");
    expect(tipOf("running")?.hasAttribute("data-open")).toBe(false);

    // A chord is not a hold: ⌘A closes it at its second key.
    await userEvent.keyboard("{Meta>}a{/Meta}");
    expect(tipOf("running")?.hasAttribute("data-open")).toBe(false);
    expect(sendOf("running").dataset.delivery).toBe("steer");
});
