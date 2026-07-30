# PWA App Login — Design QA (Latest)

## Comparison Target

- Selected visual truth: `/Users/xulater/.codex/generated_images/019fac8e-bf8f-7522-86a5-d1081c4e157d/exec-0a864fd2-c3e8-4c44-b175-52f3e6cf43d5.png`
- Normalized login crop: `/Users/xulater/Code/pi-web/docs/design/pwa-auth/source-login-390x844.png`
- Browser-rendered implementation: `/Users/xulater/Code/pi-web/docs/design/pwa-auth/login-final-390x844.png`
- Full comparison: `/Users/xulater/Code/pi-web/docs/design/pwa-auth/comparison-login.png`
- Focused form comparison: `/Users/xulater/Code/pi-web/docs/design/pwa-auth/comparison-form-focus.png`
- Intended CSS viewport: `390 × 844`, `devicePixelRatio = 1`.
- Source pixels: `1750 × 899`; selected login frame cropped from the generated two-frame board at `848 × 866`, then normalized to `390 × 844`.
- Implementation pixels: `390 × 844`.
- State: unauthenticated, expired session, light theme, empty credentials, persistent-login checkbox selected.

## Full-view Comparison Evidence

The implementation preserves the selected direction's hierarchy: centered Pi Web identity, explicit expired-session reason, two labeled credential fields, password visibility action, persistent-login choice, single blue primary action, and a quiet HTTPS/security note. The mobile layout stays within the viewport and all interactive controls remain reachable without scrolling.

The generated source board did not preserve the requested `390 × 844` frame ratio: each of its two panels was roughly square within a `1750 × 899` image. Its login form therefore becomes unnaturally narrow when normalized to a real phone viewport. The implementation intentionally keeps 24px phone margins and 342px fields so 16px input text and 44px+ touch targets remain usable on the actual PWA.

## Focused Comparison Evidence

`comparison-form-focus.png` verifies the alert, labels, fields, visibility icon, persistence control, primary button, and security note together at equal pixel density. Copy, order, semantic colors, and control affordances match. The implementation uses the existing system sans-serif and Tabler icon language rather than reproducing ImageGen's narrow synthetic glyphs.

## Findings

- No actionable P0/P1/P2 differences remain for the approved PWA login scope.
- Accepted functional deviation: the checkbox defaults to selected because the goal is to prevent repeated PWA authentication interruptions; the selected visual left it unselected.
- Accepted functional deviation: the login button is disabled until both fields are present, so its empty-form color is lighter than the mock's enabled blue button.
- Accepted responsive deviation: form controls use the readable mobile content width instead of the source board's incorrectly normalized narrow column.

## Required Fidelity Surfaces

- Fonts and typography: existing system sans-serif, 16px inputs (prevents iOS focus zoom), compact labels, centered 29px title, and readable line heights preserve Pi Web's visual language.
- Spacing and layout rhythm: centered brand and intro now align with the selected direction; 54px brand-to-title space and consistent 22px form rhythm keep the screen calm without hiding controls below the fold.
- Colors and visual tokens: white surface, `#2563eb` accent, muted gray copy, and pale red expired-session alert match the approved palette with accessible contrast.
- Image quality and asset fidelity: no raster imagery was required. Existing Pi wordmark treatment and `@tabler/icons-react` provide sharp interface assets at every density.
- Copy and content: the page states why login is required, preserves “保持登录 30 天”, and explains that passwords are not stored in the browser.

## Interaction Verification

- Protected `/?session=restore-me` returned `307` to `/login?next=%2F%3Fsession%3Drestore-me` with no native Basic Auth challenge.
- `/login` rendered at `390 × 844`; browser console check returned zero errors.
- Wrong credentials produced the inline error and HTTP `401`.
- Correct credentials produced HTTP `200`, created the session cookie, and restored `/?session=restore-me`.
- Authenticated `/api/auth/session` returned HTTP `200`.
- A chunked login payload over 4096 bytes returned HTTP `413`.
- Unit tests cover signature tampering, expiry, password rotation, open-redirect rejection, public-route scope, HTTPS cookie behavior, and required-auth fail-closed configuration.

## Comparison History

### Iteration 1

- [P2] The first mobile capture used left-aligned branding and placed the form roughly 70px above the selected direction.
  - Fix: centered the brand and intro, restored the source's vertical spacing, and kept the form inside the 390 × 844 viewport.

### Iteration 2

- Post-fix evidence: `login-final-390x844.png`, `comparison-login.png`, and `comparison-form-focus.png`.
- No remaining actionable P0/P1/P2 findings.

## Follow-up Polish

- [P3] Capture the same state from the real installed iPhone after deployment to confirm physical safe-area spacing under standalone status-bar chrome.

final result: passed

---

# Archived: Mobile Session Deck — Design QA

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
