import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const instrumentation = readFileSync(new URL("../instrumentation.ts", import.meta.url), "utf8");
const linuxUnit = readFileSync(new URL("../deploy/linux/pi-web.service", import.meta.url), "utf8");
const upstreamCheck = readFileSync(new URL("../scripts/check-upstream.sh", import.meta.url), "utf8");
const nextConfig = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
const sourceBindingScript = readFileSync(new URL("../scripts/pi-source.mjs", import.meta.url), "utf8");
const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const bunLock = readFileSync(new URL("../bun.lock", import.meta.url), "utf8");

test("npm and Bun resolve every direct Pi package to the OPC workspace", () => {
  for (const packageName of [
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
  ]) {
    const sourceSpec = manifest.dependencies[packageName];
    assert.match(sourceSpec, /^file:\.\.\/opc-os\/pi\/packages\//);
    assert.equal(manifest.overrides[packageName], sourceSpec);
    assert.equal(packageLock.packages[`node_modules/${packageName}`].link, true);
    assert.doesNotMatch(bunLock, new RegExp(`${packageName.replaceAll("/", "\\/")}@\\d`));
  }
  assert.match(sourceBindingScript, /OPC runtime package is missing a file: override/);
});

test("development and production npm entry points verify the OPC source binding", () => {
  for (const script of ["predev", "predev:lan", "prebuild", "prestart", "prestart:lan", "prebuild:mobile", "prestart:mobile"]) {
    assert.match(manifest.scripts[script], /pi:verify/);
  }
  assert.match(manifest.scripts["pi:prepare"], /scripts\/pi-source\.mjs prepare/);
});

test("direct Next startup and Linux systemd both fail closed without OPC source", () => {
  assert.match(instrumentation, /assertPiSourceRuntime\(\)/);
  assert.match(linuxUnit, /ExecStartPre=.*pi-source\.mjs verify --production/);
  assert.match(linuxUnit, /ExecStart=\/usr\/bin\/node .*next\/dist\/bin\/next start/);
});

test("upstream checks treat the OPC monorepo as the Pi source of truth", () => {
  assert.match(upstreamCheck, /PI_WEB_PI_SOURCE_DIR/);
  assert.match(upstreamCheck, /sync the whole OPC Pi monorepo at a stable tag/);
  assert.match(upstreamCheck, /runtime must still come from OPC source/);
});

test("webpack leaves OPC Pi packages external to the server bundle", () => {
  assert.match(nextConfig, /serverExternalPackages/);
  assert.match(nextConfig, /request\?\.startsWith\("@earendil-works\/pi-"\)/);
  assert.match(nextConfig, /`module \$\{request\}`/);
});
