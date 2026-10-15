import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { flushSync } from "react-dom";

export interface ClampedContentProps {
    readonly children: ReactNode;
    /** The height, in px, the content is cut to until the reader asks for the rest. */
    readonly collapsedHeight: number;
    /** Starts with the whole content shown, as after Show more. */
    readonly defaultExpanded?: boolean;
    readonly className?: string;
    readonly "data-testid"?: string;
    readonly style?: CSSProperties;
}

/** Ignore sub-pixel layout rounding when deciding the content was cut. */
const CLIP_EPSILON = 1;

/**
 * ClampedContent — a block of reading that may run long, shown cut to a fixed
 * height with the rest one press away. The cut edge fades out rather than
 * slicing a line in half, and "Show more" then grows the block to its whole
 * height, with no cap: someone who asked for the rest wants all of it.
 *
 * The control exists only while something is actually hidden. Whether that is
 * so depends on the rendered height of the content at the width it was given,
 * which no count of characters can predict, so it is measured: content that
 * fits is shown as it is, with no fade and nothing to press.
 *
 * The fade is a mask, not a coloured overlay, so the block works over any
 * surface behind it.
 */
export function ClampedContent(props: ClampedContentProps) {
    const viewportId = useId();
    const [expanded, setExpanded] = useState(props.defaultExpanded ?? false);
    const [clipped, setClipped] = useState(false);
    const measure = (content: HTMLElement) => {
        const next = content.getBoundingClientRect().height > props.collapsedHeight + CLIP_EPSILON;
        setClipped((current) => (current === next ? current : next));
    };
    return (
        <div
            className={["happy-clamped-content", props.className].filter(Boolean).join(" ")}
            data-clipped={clipped ? "" : undefined}
            data-expanded={expanded ? "" : undefined}
            data-happy-desktop-ui="clamped-content"
            data-testid={props["data-testid"]}
            style={
                {
                    ...props.style,
                    "--happy-clamped-content-height": `${props.collapsedHeight}px`,
                } as CSSProperties
            }
        >
            <div
                className="happy-clamped-content__viewport"
                data-happy-desktop-ui="clamped-content-viewport"
                id={viewportId}
                onFocus={(event) => {
                    // Tabbing reaches links below the cut too. Rather than
                    // scroll the cut block to an unseen one, show the rest.
                    // Making them inert would also hide the visible text from
                    // screen readers, which read the whole block.
                    if (!clipped || expanded) return;
                    const content = event.currentTarget.firstElementChild;
                    if (!content) return;
                    const target = event.target;
                    const bottom =
                        target.getBoundingClientRect().bottom - content.getBoundingClientRect().top;
                    if (bottom <= props.collapsedHeight + CLIP_EPSILON) return;
                    flushSync(() => setExpanded(true));
                    target.scrollIntoView({ block: "nearest" });
                }}
            >
                <div
                    className="happy-clamped-content__content"
                    data-happy-desktop-ui="clamped-content-content"
                    ref={(node) => {
                        if (!node) return undefined;
                        measure(node);
                        // The content's height follows both its width and what
                        // is inside it, and neither change is an event: the
                        // observer is the only way to learn it now fits or no
                        // longer does.
                        const observer = new ResizeObserver(() => measure(node));
                        observer.observe(node);
                        return () => observer.disconnect();
                    }}
                >
                    {props.children}
                </div>
            </div>
            {clipped ? (
                // A line of text rather than a padded button, so its words start
                // on the same left edge as the reading above it.
                <button
                    aria-controls={viewportId}
                    aria-expanded={expanded}
                    className="happy-clamped-content__toggle"
                    data-happy-desktop-ui="clamped-content-toggle"
                    onClick={() => setExpanded((current) => !current)}
                    type="button"
                >
                    {expanded ? "Show less" : "Show more"}
                </button>
            ) : null}
        </div>
    );
}
