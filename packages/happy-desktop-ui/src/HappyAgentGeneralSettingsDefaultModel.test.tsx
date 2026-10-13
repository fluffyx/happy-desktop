import { useSyncExternalStore } from "react";
import { expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { happyAgentSettingsStoreCreate, type HappyAgentThinkingLevel } from "happy-desktop-state";
import "./styles.css";
import { HappyAgentGeneralSettings } from "./pages/settings/HappyAgentGeneralSettings";
import { createRenderer } from "./testing";

const LAST_USED = "last-used";
const SOL = "codex:openai/gpt-5.6-sol";

const modelOptions = [
    { label: "Last used model", value: LAST_USED },
    { label: "Codex · GPT-5.6 Sol", value: SOL },
    { label: "Claude · Opus 5 1M", value: "claude:anthropic/opus-5" },
];

const effortOptions = [
    { label: "Low", value: "low" },
    { label: "Medium", value: "medium" },
    { label: "High", value: "high" },
];

const noop = () => undefined;

it("shows Last used model with effort following the last pick, and keeps both pickers across a choice", async () => {
    const store = happyAgentSettingsStoreCreate({ defaultEffort: "medium" });
    let subscriptions = 0;
    const subscribe = (listener: () => void) => {
        subscriptions++;
        const unsubscribe = store.subscribe(listener);
        return () => {
            subscriptions--;
            unsubscribe();
        };
    };
    // The app's own projection of the settings store onto the page's props.
    function Fixture() {
        const settings = useSyncExternalStore(subscribe, store.get, store.get);
        const chosen =
            settings.defaultProviderId && settings.defaultModelId
                ? `${settings.defaultProviderId}:${settings.defaultModelId}`
                : undefined;
        return (
            <HappyAgentGeneralSettings
                appearance="system"
                defaultModelKey={chosen ?? LAST_USED}
                effort={settings.defaultEffort}
                effortFollowsLastPick={chosen === undefined}
                effortOptions={effortOptions}
                experimentalFeaturesEnabled={false}
                linkOpenPlacement="panel"
                modelOptions={modelOptions}
                onAppearanceChange={noop}
                onDefaultModelChange={(key) => {
                    if (key === LAST_USED) return store.defaultModelClear();
                    const [providerId, ...rest] = key.split(":");
                    store.defaultModelUpdate(providerId!, rest.join(":"));
                }}
                onEffortChange={(effort) =>
                    store.defaultEffortUpdate(effort as HappyAgentThinkingLevel)
                }
                onExperimentalFeaturesChange={noop}
                onLinkOpenPlacementChange={noop}
                onPermissionModeChange={noop}
                onScrollbarVisibilityChange={noop}
                onTitleShimmerChange={noop}
                permissionMode="auto"
                permissionModeOptions={[{ label: "Auto", value: "auto" }]}
                scrollbarVisibility="automatic"
                titleShimmerEnabled={false}
            />
        );
    }
    const view = createRenderer();
    view.render(() => <Fixture />, { width: 760, height: 900, padding: 24 });
    await view.ready();
    expect(window.devicePixelRatio).toBe(2);
    expect(subscriptions).toBe(1);

    const model = view.$("#happy-agent-settings-default-model");
    const effort = view.$("#happy-agent-settings-effort");
    const modelSelect = model.element as HTMLSelectElement;
    const effortSelect = effort.element as HTMLSelectElement;
    const effortRoot = view.$('[data-happy-desktop-ui="select"]:has(#happy-agent-settings-effort)');
    const effortValue = view.$(
        '[data-happy-desktop-ui="select"]:has(#happy-agent-settings-effort) [data-happy-desktop-ui="select-value"]',
    );
    const modelValue = view.$(
        '[data-happy-desktop-ui="select"]:has(#happy-agent-settings-default-model) [data-happy-desktop-ui="select-value"]',
    );
    const section = view.$(
        '[data-happy-desktop-ui="happy-agent-settings-section"]:has(#happy-agent-settings-effort)',
    );
    expect(section.element.textContent).toContain(
        "Last used model starts with whatever you last picked in a chat box; choose a model to always start with it.",
    );

    // Last used model: the first choice, and effort is not the page's to set.
    // The first option is the Select's own hidden placeholder.
    expect(modelSelect.options[1]?.value).toBe(LAST_USED);
    expect(modelSelect.value).toBe(LAST_USED);
    expect(modelValue.textMetrics().text).toBe("Last used model");
    expect(effortSelect.disabled).toBe(true);
    expect(effortSelect.value).toBe("");
    expect(effortRoot.element.getAttribute("data-placeholder")).toBe("");
    expect(effortValue.textMetrics().text).toBe("Follows your last pick");
    expect(effortValue.computedStyle("color")).toBe("rgb(153, 153, 153)");
    expect(effortRoot.computedStyles(["cursor", "opacity"])).toEqual({
        cursor: "not-allowed",
        opacity: "0.48",
    });
    const effortControl = view.$(
        '[data-happy-desktop-ui="select"]:has(#happy-agent-settings-effort) [data-happy-desktop-ui="select-control"]',
    );
    expect(effortControl.bounds().width).toBe(280);
    expect(effortControl.bounds().height).toBe(28);
    const ink = await effortValue.visibleMetrics();
    expect(ink.pixelCount).toBeGreaterThan(0);
    expect(ink.bounds.x + ink.bounds.width).toBeLessThanOrEqual(effortValue.bounds().width);
    await view.screenshot("HappyAgentGeneralSettingsDefaultModel.last-used.test");

    // Choosing a model hands effort back to Settings without replacing either picker.
    await userEvent.selectOptions(modelSelect, SOL);
    await expect.poll(() => effortSelect.disabled).toBe(false);
    expect(store.get()).toMatchObject({
        defaultProviderId: "codex",
        defaultModelId: "openai/gpt-5.6-sol",
    });
    expect(modelSelect.value).toBe(SOL);
    expect(effortSelect.value).toBe("medium");
    expect(effortValue.textMetrics().text).toBe("Medium");
    expect(effortRoot.element.hasAttribute("data-placeholder")).toBe(false);
    expect(effortRoot.computedStyle("opacity")).toBe("1");
    expect(view.$("#happy-agent-settings-default-model").element).toBe(modelSelect);
    expect(view.$("#happy-agent-settings-effort").element).toBe(effortSelect);
    expect(subscriptions).toBe(1);
    await view.screenshot("HappyAgentGeneralSettingsDefaultModel.pinned.test");

    await userEvent.selectOptions(modelSelect, LAST_USED);
    await expect.poll(() => effortSelect.disabled).toBe(true);
    expect(store.get().defaultModelId).toBeUndefined();
    expect(effortValue.textMetrics().text).toBe("Follows your last pick");
    expect(view.$("#happy-agent-settings-effort").element).toBe(effortSelect);

    view.destroy();
    expect(subscriptions).toBe(0);
});
