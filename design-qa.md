# Mobile Session Deck — Design QA

## Comparison Target

- Source visual truth: `/Users/xulater/Code/pi-web/docs/design/mobile-session-deck/selected-session-deck.png`
- Final implementation capture: `/Users/xulater/Code/pi-web/docs/design/mobile-session-deck/implementation-390x844.png`
- Full comparison: `/Users/xulater/Code/pi-web/docs/design/mobile-session-deck/comparison-full.png`
- Focused header comparison: `/Users/xulater/Code/pi-web/docs/design/mobile-session-deck/comparison-header.png`
- Focused composer comparison: `/Users/xulater/Code/pi-web/docs/design/mobile-session-deck/comparison-composer.png`
- Mobile menu state: `/Users/xulater/Code/pi-web/docs/design/mobile-session-deck/mobile-menu-390x844.png`

## Normalization

- Intended CSS viewport: `390 × 844`.
- Source pixels: `853 × 1844`; normalized to `390 × 844` for comparison.
- Implementation pixels: `390 × 844`.
- Browser-reported viewport: `390 × 844`, `devicePixelRatio = 2`; the in-app browser screenshot API returned a CSS-pixel-normalized image.
- State: light theme, real `pi-web` project and existing session, empty composer, no active agent run.
- The source contains illustrative running/tool content while the implementation uses real session content. Structural regions—not literal conversation copy—are the comparison truth because the user explicitly prioritized interaction design and preservation of the existing Pi Web renderer.

## Evidence

### Full-view comparison

The final screen preserves the source hierarchy:

1. Compact project control plus refresh and overflow actions.
2. Horizontally scrollable recent-session deck with active/running state semantics.
3. Conversation as the dominant content surface.
4. Fixed two-level composer with primary send action and secondary model/tool controls.

The implementation intentionally retains the existing Pi Web message renderer, Markdown, tool results, copying, branching, token usage, and streaming states instead of replacing them with static design-only message blocks.

### Focused comparisons

- Header: `comparison-header.png` confirms matching project context, refresh/overflow actions, active session emphasis, horizontal switching, and permanently reachable new-session action.
- Composer: `comparison-composer.png` confirms a single rounded bottom surface, multiline input region, send action, separator, attachment/model controls, and More entry.
- Menu: `mobile-menu-390x844.png` confirms that files, history, theme, project/session browser, advanced session controls, and mobile self-check remain reachable without restoring the desktop toolbar to the main screen.

## Required Fidelity Surfaces

- Fonts and typography: system sans-serif remains the primary UI/prose face; technical content continues to use the existing monospace token. Sizes and weights retain the source's compact hierarchy while preserving Pi Web Markdown rendering.
- Spacing and layout rhythm: header, deck, conversation, and composer are distinct full-width regions. Touch controls are at least 44px. The composer respects the existing safe-area/VisualViewport behavior.
- Colors and visual tokens: neutral light/dark surfaces, muted borders, blue active state, and green running state are mapped through `--mobile-*` tokens so later themes can override appearance without restructuring interaction.
- Image quality and asset fidelity: the target contains no raster imagery. New generic controls use `@tabler/icons-react`; no generated placeholder imagery was introduced.
- Copy and content: project/session names and conversation content come from the real Pi Web backend. Labels describe actual actions and are accessible by name.

## Interaction Verification

- Public Basic Auth with `later` returned HTTP `200`.
- Session Deck loaded real sessions from `/api/sessions`.
- Running state remains subscribed to `/api/agent/running/events`.
- Mobile overflow menu opened and exposed six reachable destinations.
- Selecting a recent session changed the active session and URL.
- New-session `+` opened the existing unsaved-session flow without creating duplicate backend logic.
- Project control opened the existing project/session drawer.
- Refresh control completed without errors.
- Browser console error check: no errors.

## Comparison History

### Iteration 1

- [P2] Composer controls were visually outside the message-entry surface.
  - Fix: merged input and controls into one bordered mobile composer with a separated secondary row.
- [P2] Wide session chips pushed the new-session action offscreen.
  - Fix: capped chips at `164px` and made the `+` action sticky on the right edge.

### Iteration 2

- Post-fix evidence: `comparison-full.png`, `comparison-header.png`, and `comparison-composer.png`.
- No remaining actionable P0/P1/P2 differences for the user-approved interaction-first scope.

## Follow-up Polish

- [P3] A dedicated mobile message presentation could add the source's avatars and flatter message layout, but this should remain a theme/presentation pass because the current renderer preserves more Pi Web functionality.
- [P3] Add a theme picker after the interaction model has been exercised on the real iPhone; the token boundary is already in place.
- [P3] Capture an actual running-session state on the iPhone to visually validate the green live indicator under real background/foreground transitions.

final result: passed
