import { expect, it } from "vitest";
import { commandPaletteResults, type CommandPaletteInput } from "../sources/commandPaletteResults";

/* The send key and the follow-up behavior answer in the palette itself, each
 * offering the other choice as its next value, and only where the host keeps
 * the choice at all. */

const INPUT: CommandPaletteInput = {
    happyAgentId: "agent-1",
    projects: [],
    archivedSessions: [],
    tabs: [],
    tabStepAvailable: false,
    sessionCreateAvailable: false,
    workspaceCreateAvailable: false,
    taskCreateAvailable: false,
    query: "",
    themeMode: "system",
    scrollbarVisibility: "automatic",
    linkOpenPlacement: "panel",
    titleShimmerEnabled: false,
    experimentalFeaturesEnabled: false,
};

const settingOf = (input: CommandPaletteInput, id: string) =>
    commandPaletteResults(input).rows.find((row) => row.id === id);

it("offers the send key and the follow-up behavior where the host keeps them", () => {
    const input = { ...INPUT, query: "enter", sendKey: "enter", followUp: "steer" } as const;
    expect(settingOf(input, "setting:send-key")).toMatchObject({
        kind: "setting",
        setting: "sendKey",
        label: "Send messages with",
        description: "Shift+Enter adds a new line",
        control: { kind: "segmented", value: "enter", next: "cmdEnter" },
    });
    expect(settingOf({ ...input, sendKey: "cmdEnter" }, "setting:send-key")).toMatchObject({
        description: "Enter adds a new line",
        control: { value: "cmdEnter", next: "enter" },
    });
    expect(settingOf({ ...input, query: "queue" }, "setting:follow-up")).toMatchObject({
        setting: "followUp",
        control: { kind: "segmented", value: "steer", next: "queue" },
    });

    // The ⌘ Enter choice is found by what its key is called, too.
    for (const query of ["cmd", "command", "⌘"])
        expect(settingOf({ ...input, query }, "setting:send-key")).toBeDefined();

    // A host that keeps neither offers neither row.
    expect(settingOf({ ...INPUT, query: "enter" }, "setting:send-key")).toBeUndefined();
    expect(settingOf({ ...INPUT, query: "queue" }, "setting:follow-up")).toBeUndefined();
});
