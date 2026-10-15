import { ClampedContent } from "../../src/ClampedContent";
import { renderMessageMarkdown } from "../../src/MessageMarkdown";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-297";

const SHORT = "The permissions table holds **40 million** rows, so the lock time matters.";

const LONG = [
    "I looked at how the permissions table is used before changing it.",
    "- It holds **40 million** rows and grows by about 200,000 a day.",
    "- Three services read it on every request; one writes to it.",
    "- The nightly backup locks it for roughly four minutes.",
    "Migrating in one transaction keeps every reader consistent, but holds the lock for the whole copy. Migrating in batches keeps the lock short, but readers can see a mix of old and new rows while it runs.",
    "Either way the column rename has to ship first, and the old column stays until every service has been redeployed.",
].join("\n\n");

/** The inbox lead-in's own type, so the specimen is cut where the inbox cuts it. */
function Body(props: { source: string }) {
    return (
        <div
            className="happy-agent-inbox__lead-in-text happy-message__body--markdown"
            data-markdown=""
        >
            {renderMessageMarkdown(props.source)}
        </div>
    );
}

export function ClampedContentPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="A block of reading cut to a fixed height, with a fade over the cut edge and a Show more control that grows it to its whole height. Content that fits is shown as it is, with no fade and no control."
            title="ClampedContent"
        >
            <Specimen
                detail="One paragraph, shorter than the 140px cut: shown whole, nothing to press."
                label="Fits"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 480 }}>
                    <DimensionRule label="480" />
                    <ClampedContent collapsedHeight={140}>
                        <Body source={SHORT} />
                    </ClampedContent>
                </div>
            </Specimen>
            <Specimen
                detail="Longer than the cut: 140px (seven 20px lines) with a 40px fade, and Show more one 4px gap below."
                label="Clipped"
                number="02"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 480 }}>
                    <DimensionRule label="480" />
                    <ClampedContent collapsedHeight={140}>
                        <Body source={LONG} />
                    </ClampedContent>
                </div>
            </Specimen>
            <Specimen
                detail="After Show more: the whole content with no cap and no fade, and Show less in the same place under it."
                label="Expanded"
                number="03"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 480 }}>
                    <DimensionRule label="480" />
                    <ClampedContent collapsedHeight={140} defaultExpanded>
                        <Body source={LONG} />
                    </ClampedContent>
                </div>
            </Specimen>
        </ComponentPage>
    );
}
