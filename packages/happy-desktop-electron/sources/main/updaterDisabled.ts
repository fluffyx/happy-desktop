import type { DesktopUpdater } from "./updater";

/**
 * Fluffy never updates itself. Its only release feed would be the official Happy
 * Desktop releases, and installing one would replace this fork with upstream, so
 * there is no feed to check, nothing to download, and no install to offer. The
 * desktop update snapshot stays idle, which the renderer shows as no prompt.
 *
 * Only the type is imported from `./updater`, so electron-updater is never loaded.
 * Happy Agent updates are unaffected: they come from Happy Agent's own releases.
 */
export const desktopUpdaterDisabled: DesktopUpdater = {
    check: () => Promise.resolve(),
    install: () => false,
    previewUpdate: () => undefined,
};
