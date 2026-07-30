import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./DeviceSwitcher.tsx", import.meta.url), "utf8");

test("hides the device switcher until at least two devices are configured", () => {
  assert.match(source, /directory\.devices\.length < 2\) return null/);
});

test("receives directory data as a prop instead of fetching inside the UI component", () => {
  assert.doesNotMatch(source, /useDeviceDirectory/);
  assert.match(source, /directory: DeviceDirectoryResponse \| null/);
});

test("keeps current device disabled and navigates other devices by configured URL", () => {
  assert.match(source, /disabled=\{isCurrent\}/);
  assert.match(source, /window\.location\.assign\(device\.url\)/);
  assert.match(source, /aria-current=\{isCurrent \? "page" : undefined\}/);
});

test("closes on outside pointer input and Escape", () => {
  assert.match(source, /document\.addEventListener\("pointerdown", onPointerDown\)/);
  assert.match(source, /event\.key === "Escape"/);
});
