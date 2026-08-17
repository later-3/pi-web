import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assertPiSourceRuntime, getPiSourcePublicInfo } from "./pi-source-runtime.ts";

function createFixture({ linked = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pi-web-source-runtime-"));
  const sourcePackage = join(root, "opc", "packages", "coding-agent");
  const targetPackage = join(root, "web", "node_modules", "@earendil-works", "pi-coding-agent");
  mkdirSync(join(sourcePackage, "dist"), { recursive: true });
  mkdirSync(join(root, "web", "node_modules", "@earendil-works"), { recursive: true });
  writeFileSync(join(sourcePackage, "dist", "index.js"), "export {};\n");
  if (linked) symlinkSync(sourcePackage, targetPackage, "dir");
  else mkdirSync(targetPackage, { recursive: true });
  writeFileSync(
    join(root, "web", "node_modules", ".pi-web-source.json"),
    JSON.stringify({
      schemaVersion: 1,
      mode: "opc-source",
      sourceRoot: join(root, "opc"),
      git: { commit: "1234567890abcdef", shortCommit: "1234567890ab", dirty: false },
      packages: [
        {
          name: "@earendil-works/pi-coding-agent",
          version: "0.84.2",
          sourceDirectory: realpathSync(sourcePackage),
          entryRelativePath: "dist/index.js",
        },
      ],
    }),
  );
  return { projectRoot: join(root, "web"), root };
}

test("accepts a runtime package linked to the prepared OPC source", () => {
  const fixture = createFixture();
  try {
    assert.equal(assertPiSourceRuntime(fixture.projectRoot).mode, "opc-source");
    assert.deepEqual(getPiSourcePublicInfo(fixture.projectRoot), {
      mode: "opc-source",
      version: "0.84.2",
      commit: "1234567890ab",
      dirty: false,
      packageCount: 1,
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects a registry package directory even when a source state file exists", () => {
  const fixture = createFixture({ linked: false });
  try {
    assert.throws(
      () => assertPiSourceRuntime(fixture.projectRoot),
      /must load @earendil-works\/pi-coding-agent from OPC source/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
