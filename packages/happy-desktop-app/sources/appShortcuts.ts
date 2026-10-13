import { commandShortcut } from "happy-desktop-ui";

/**
 * The window's Command chords, in one place because two surfaces read them: the
 * dispatchers that run them, and the command palette, which shows the same cap
 * beside the row that does the same thing. A chord written down twice would
 * eventually promise one key and run another.
 */
export const APP_SHORTCUTS = {
    /** Opens the command palette. Closing it again is the palette's own key. */
    paletteOpen: commandShortcut("k"),
    panelToggle: commandShortcut("j"),
    panelToggleAlternate: commandShortcut("b", { alt: true }),
    sessionCreate: commandShortcut("t"),
    tabClose: commandShortcut("w"),
    /** Opens the new-task surface on the active Happy Agent, as its Tasks heading's + does. */
    taskCreate: commandShortcut("n"),
    /** Opens the newest unread chat; one waiting on a question comes first. */
    unreadNextOpen: commandShortcut("l", { alt: true }),
    /**
     * Opens the oldest unread chat. Shift reverses Next rather than reaching for
     * a letter of its own: Option-Command-H is macOS's Hide Others.
     */
    unreadPreviousOpen: commandShortcut("l", { alt: true, shift: true }),
    workspaceCreate: commandShortcut("n", { shift: true }),
} as const;
