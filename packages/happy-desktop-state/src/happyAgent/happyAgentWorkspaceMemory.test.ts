import { describe, expect, it } from "vitest";
import { happyAgentPanelStoreCreate } from "./happyAgentPanelStore.js";
import type { HappyAgentGroupId } from "./happyAgentTypes.js";
import {
    happyAgentWorkspaceMemoryStoreCreate,
    type HappyAgentWorkspaceMemoryDocument,
    type HappyAgentWorkspaceMemoryPersistence,
} from "./happyAgentWorkspaceMemory.js";

const group = "project_1" as HappyAgentGroupId;

/** Storage that outlives the store reading it, the way a file outlives a run. */
function persistenceCreate(
    initial?: HappyAgentWorkspaceMemoryDocument,
): HappyAgentWorkspaceMemoryPersistence {
    let document = initial;
    return {
        read: () => document,
        write: (next) => {
            document = JSON.parse(JSON.stringify(next)) as HappyAgentWorkspaceMemoryDocument;
        },
    };
}

describe("happyAgentWorkspaceMemoryStore panel memory", () => {
    it("reads back the strip each remembered page was being read in", () => {
        const persistence = persistenceCreate();
        happyAgentWorkspaceMemoryStoreCreate(persistence).groupPanelWrite(group, {
            open: true,
            browsers: [
                { url: "https://example.com/main", label: "Main", placement: "main" },
                { url: "https://example.com/panel", label: "Panel", placement: "panel" },
            ],
            active: { type: "browser", index: 1 },
        });

        const restarted = happyAgentWorkspaceMemoryStoreCreate(persistence);

        expect(restarted.groupRead(group)?.panel?.browsers).toEqual([
            { url: "https://example.com/main", label: "Main", placement: "main" },
            { url: "https://example.com/panel", label: "Panel", placement: "panel" },
        ]);
    });

    it("leaves out a placement that is missing or not one of the two strips", () => {
        const persistence = persistenceCreate({
            groups: {
                [group]: {
                    history: [],
                    files: [],
                    panel: {
                        open: true,
                        browsers: [
                            { url: "https://example.com/old", label: "Old" },
                            {
                                url: "https://example.com/odd",
                                label: "Odd",
                                placement: "sidebar",
                            } as never,
                        ],
                        active: { type: "files" },
                    },
                },
            },
        });

        const browsers =
            happyAgentWorkspaceMemoryStoreCreate(persistence).groupRead(group)?.panel?.browsers;

        expect(browsers).toEqual([
            { url: "https://example.com/old", label: "Old" },
            { url: "https://example.com/odd", label: "Odd" },
        ]);
        expect(browsers?.every((browser) => !("placement" in browser))).toBe(true);
    });

    it("returns a page left in the main content to the main content after a restart", () => {
        const persistence = persistenceCreate();
        const panelCreate = () => {
            const memory = happyAgentWorkspaceMemoryStoreCreate(persistence);
            const panel = happyAgentPanelStoreCreate({
                terminalOpen: () => {
                    throw new Error("No terminal is opened here.");
                },
                memoryRead: (groupId) => memory.groupRead(groupId)?.panel,
                memoryWrite: (groupId, value) => memory.groupPanelWrite(groupId, value),
            });
            panel.scopeApply(group, undefined);
            return panel;
        };

        const before = panelCreate();
        before.browserAdd("https://example.com/");
        const [page] = before.get().tabs;
        before.tabPlacementUpdate(page!.id, "main");
        before[Symbol.dispose]();

        const after = panelCreate();

        expect(after.get().tabs.map((tab) => [tab.kind, tab.placement])).toEqual([
            ["browser", "main"],
        ]);
        after[Symbol.dispose]();
    });
});
