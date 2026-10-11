import { type ReactNode } from "react";
import { expect, it, onTestFinished, vi } from "vitest";
import "./styles.css";
import { MarkdownDocument } from "./MarkdownDocument";
import { Message } from "./Message";
import { createRenderer } from "./testing";

/** One Markdown code block and the exact text its copy action must hand over. */
type CopyCase = { readonly name: string; readonly markdown: string; readonly copied: string };

const COPY_CASES: readonly CopyCase[] = [
    {
        name: "a labelled fence",
        markdown: "```bash\npnpm install\npnpm dev\n```",
        copied: "pnpm install\npnpm dev",
    },
    {
        name: "an empty fence",
        markdown: "```\n```",
        copied: "",
    },
    {
        name: "a fence whose lines are indented",
        markdown: "```ts\nif (ready) {\n    start();\n\tstop();\n}\n```",
        copied: "if (ready) {\n    start();\n\tstop();\n}",
    },
    {
        name: "an indented code block",
        markdown: "Run:\n\n    pnpm install\n      --frozen-lockfile",
        copied: "pnpm install\n  --frozen-lockfile",
    },
    {
        name: "a fence that ends in authored blank lines",
        markdown: "```\nfirst\n\n\n```",
        copied: "first\n\n",
    },
];

/** The two Markdown surfaces that frame their code blocks with a copy action. */
const SURFACES: readonly {
    readonly name: string;
    readonly render: (markdown: string) => ReactNode;
}[] = [
    {
        name: "chat message",
        render: (markdown) => <Message agent author="Happy" body={markdown} />,
    },
    {
        name: "Markdown document",
        render: (markdown) => (
            <MarkdownDocument style={{ height: "400px", width: "640px" }} text={markdown} />
        ),
    },
];

/** Replaces the browser clipboard for one test, so each engine's permission model is out of the way. */
function clipboardCapture() {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
    });
    onTestFinished(() => {
        if (original) Object.defineProperty(navigator, "clipboard", original);
        else Reflect.deleteProperty(navigator, "clipboard");
    });
    return writeText;
}

for (const surface of SURFACES) {
    for (const copyCase of COPY_CASES) {
        it(`copies exactly the code of ${copyCase.name} in a ${surface.name}`, async () => {
            const writeText = clipboardCapture();
            const view = createRenderer();
            view.render(
                () => <div data-testid="surface">{surface.render(copyCase.markdown)}</div>,
                {
                    width: 720,
                    height: 480,
                },
            );
            await view.ready();
            const buttons = view.container.querySelectorAll<HTMLButtonElement>(
                '[data-testid="surface"] [data-happy-desktop-ui="code-block-copy"]',
            );
            expect(buttons).toHaveLength(1);
            const button = buttons[0]!;
            expect(button.getAttribute("aria-label")).toBe("Copy code");

            button.click();

            expect(writeText).toHaveBeenCalledTimes(1);
            expect(writeText).toHaveBeenCalledWith(copyCase.copied);
            await expect.poll(() => button.getAttribute("aria-label")).toBe("Copied");
        });
    }
}
