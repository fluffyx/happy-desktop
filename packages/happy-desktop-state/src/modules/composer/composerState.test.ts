import { describe, expect, it } from "vitest";
import { UserError } from "../../types.js";
import { composerStoreCreate, type ComposerOutput } from "./composerState.js";

describe("composerState slash commands", () => {
    it("clears the durable draft before invoking an accepted command", () => {
        const output: ComposerOutput[] = [];
        const store = composerStoreCreate("session-a", {
            capabilities: {
                shellMode: false,
                commands: [{ id: "agents", label: "/agents" }],
                mentions: false,
            },
            now: () => 42,
            output: (event) => output.push(event),
        });

        store.getState().textUpdate("/agents");
        output.length = 0;
        store.getState().commandInvoke("agents", "steer");

        expect(store.getState()).toMatchObject({
            text: "",
            textUpdatedAt: 42,
            commandQuery: undefined,
        });
        expect(output).toEqual([
            { type: "textUpdated", scopeId: "session-a", text: "" },
            {
                type: "commandInvoked",
                scopeId: "session-a",
                commandId: "agents",
                delivery: "steer",
            },
        ]);
    });
});

describe("composerState delivery", () => {
    it("carries the delivery the send key chose on a submitted message", () => {
        const output: ComposerOutput[] = [];
        const store = composerStoreCreate("session-a", {
            capabilities: { shellMode: false, commands: [], mentions: false },
            output: (event) => output.push(event),
        });

        store.getState().textUpdate("after this, run the tests");
        store.getState().textSubmit("queue");

        expect(output.at(-1)).toMatchObject({
            type: "textSubmitted",
            text: "after this, run the tests",
            delivery: "queue",
        });
    });

    it("carries the delivery on a typed skill, which is sent as a message", () => {
        const output: ComposerOutput[] = [];
        const store = composerStoreCreate("session-a", {
            capabilities: {
                shellMode: false,
                commands: [{ id: "review", label: "/review", hasArguments: true, kind: "skill" }],
                mentions: false,
            },
            output: (event) => output.push(event),
        });

        store.getState().textUpdate("/review the diff");
        store.getState().textSubmit("queue");

        expect(output.at(-1)).toMatchObject({
            type: "commandInvoked",
            commandId: "review",
            arguments: "the diff",
            delivery: "queue",
        });
    });

    it("keeps the chosen delivery on a refused send, so a retry sends it the same way", () => {
        const store = composerStoreCreate("session-a", {
            capabilities: { shellMode: false, commands: [], mentions: false },
        });

        store.getState().textUpdate("after this, run the tests");
        store.getState().textSubmit("queue");
        const pending = store.getState().submission;
        expect(pending).toMatchObject({ status: "pending", delivery: "queue" });
        if (pending.status !== "pending") return;

        store.getState().composerInput({
            type: "submissionFailed",
            revision: pending.revision,
            error: new UserError("Happy Agent refused the message."),
        });
        expect(store.getState().submission).toMatchObject({ status: "failed", delivery: "queue" });
    });
});
