# Gauntlet 2 audit

The previous restoration is present as working-tree changes on top of d4a264f. It has not been isolated in its own commit. The browser preview explicitly uses simulated data.

## Restored and checked
- Global game cards open contextual environments.
- Minecraft has Home, Library, Discover Content, Skin Selector, Model Builder and Settings.
- Dedicated games retain their supported mod, CC and load-order pages.
- Global Home has no launch button.
- Minecraft's global chart aggregates instances. Its own chart supports individual series.
- Existing shared tokens, chart components, sidebar transitions and download queue are reusable.

## This iteration
- Dashboard statistics and activity refresh on focus, Minecraft exit and every minute while visible.
- Refresh results are discarded after unmount, and overlapping refresh requests are suppressed.
- Instance chart memoization follows the selected daily data.
- Global totals are labeled as recorded totals.
- Skin texture load rejection has visible feedback.
- Skin rotation and pointer animation respect changes to reduced-motion preferences and clean up listeners.

## Prioritized remaining backlog
1. Verify current source in Electron against actual accounts, installation detection, game launch and mod installation. Browser simulation cannot establish these.
2. Add reliable session-duration tracking for supported non-Minecraft launch paths, including external launchers and compatibility layers. Last launch timestamps alone cannot establish duration.
3. Feed recorded per-game durations into the global chart and other game dashboards. Their current unavailable states are accurate.
4. Verify skin selection events, geometry and texture failures using the desktop account integration.
5. Exercise Discover project back navigation, interrupted downloads and settings persistence with real integrations.
6. Review every major page at narrow and wide desktop sizes. This iteration visually inspected global Home at desktop width.
7. Reduce the large production JavaScript bundle using measured loading boundaries.

## Validation limits
The production build and targeted lint are run for this iteration. The final acceptance checklist in the supplied brief ends after the distinct Minecraft and Sims contexts item. No additional checklist text was supplied.
