import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./MobileDeviceSwitcher.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("./MobileDeviceSwitcher.module.css", import.meta.url), "utf8");
const header = await readFile(new URL("./MobileWorkspaceHeader.tsx", import.meta.url), "utf8");

test("keeps device switching at the first mobile navigation level", () => {
  const headerActions = header.slice(
    header.indexOf('<div className="mobile-header-actions">'),
    header.indexOf("</header>"),
  );
  const actionSheet = header.slice(header.indexOf('{menuOpen && ('), header.indexOf("</section>"));

  assert.match(headerActions, /<MobileDeviceSwitcher/);
  assert.doesNotMatch(actionSheet, /<DeviceSwitcher/);
  assert.ok(headerActions.indexOf("<MobileDeviceSwitcher") < headerActions.indexOf("<IconPlus"));
});

test("switches a target device in two taps without a nested menu", () => {
  assert.match(source, /onClick=\{\(\) => \{[\s\S]*setOpen\(true\)/);
  assert.match(source, /onClick=\{\(\) => void navigate\(device\)\}/);
  assert.match(source, /role="dialog"/);
  assert.doesNotMatch(source, /role="menu"/);
});

test("shows committed switching feedback before the workspace transition", () => {
  assert.match(source, /flushSync\(\(\) => setSwitchingId\(device\.id\)\)/);
  assert.ok(source.indexOf("setSwitchingId(device.id)") < source.indexOf("await onNavigate(device)"));
  assert.match(source, /aria-busy=\{isSwitching \|\| undefined\}/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /role="alert"/);
});

test("prevents repeat switching and keeps the current device selected", () => {
  assert.match(source, /device\.id === directory\.currentDeviceId \|\| switchingId/);
  assert.match(source, /disabled=\{isCurrent \|\| switchingId !== null\}/);
  assert.match(source, /aria-current=\{isCurrent \? "page" : undefined\}/);
});

test("restores trigger focus, closes on Escape, and traps keyboard focus", () => {
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /triggerRef\.current\?\.focus\(\)/);
  assert.match(source, /querySelectorAll<HTMLButtonElement>\("button:not\(:disabled\)"\)/);
  assert.match(source, /event\.key !== "Tab"/);
});

test("uses touch-safe controls, safe areas, and bounded small-screen layout", () => {
  assert.match(styles, /height: 44px/);
  assert.match(styles, /min-height: 62px/);
  assert.match(styles, /left: max\(10px, var\(--safe-area-left\)\)/);
  assert.match(styles, /bottom: max\(10px, var\(--safe-area-bottom\)\)/);
  assert.match(styles, /@media \(max-width: 360px\)/);
});

test("keeps refresh available in the main action sheet", () => {
  const headerActions = header.slice(
    header.indexOf('<div className="mobile-header-actions">'),
    header.indexOf("</header>"),
  );
  assert.doesNotMatch(headerActions, /<IconRefresh/);
  assert.match(header, /mobile-action-sheet-header-actions[\s\S]*<IconRefresh/);
});
