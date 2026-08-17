#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const statePath = join(projectRoot, "node_modules", ".pi-web-source.json");
const packageScopeDir = join(projectRoot, "node_modules", "@earendil-works");
const piPackagePrefix = "@earendil-works/pi-";
const ignoredDiscoveryDirectories = new Set([".git", "dist", "node_modules"]);

function fail(message) {
  throw new Error(message);
}

function expandHome(value) {
  if (value === "~") return homedir();
  if (value.startsWith(`~${sep}`)) return join(homedir(), value.slice(2));
  return value;
}

function configuredSourceRoot() {
  const configured = process.env.PI_WEB_PI_SOURCE_DIR?.trim();
  return resolve(expandHome(configured || join(projectRoot, "..", "opc-os", "pi")));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function runGit(sourceRoot, args, options = {}) {
  const result = spawnSync("git", ["-C", sourceRoot, ...args], {
    encoding: options.encoding ?? "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = typeof result.stderr === "string" ? result.stderr.trim() : "";
    fail(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout;
}

function discoverWorkspacePackages(sourceRoot) {
  const packagesRoot = join(sourceRoot, "packages");
  if (!existsSync(packagesRoot)) fail(`OPC Pi packages directory not found: ${packagesRoot}`);

  const discovered = new Map();
  const visit = (directory) => {
    const manifestPath = join(directory, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = readJson(manifestPath);
      if (typeof manifest.name === "string" && manifest.name.startsWith(piPackagePrefix)) {
        if (discovered.has(manifest.name)) fail(`Duplicate OPC Pi package: ${manifest.name}`);
        discovered.set(manifest.name, { directory, manifest, manifestPath });
      }
    }

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || ignoredDiscoveryDirectories.has(entry.name)) continue;
      visit(join(directory, entry.name));
    }
  };

  visit(packagesRoot);
  return discovered;
}

function projectManifest() {
  return readJson(join(projectRoot, "package.json"));
}

function directPiDependencies(manifest = projectManifest()) {
  return Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith(piPackagePrefix)).sort();
}

function runtimePackageClosure(discovered) {
  const queue = [...directPiDependencies()];
  const selected = new Map();

  while (queue.length > 0) {
    const name = queue.shift();
    if (selected.has(name)) continue;
    const workspacePackage = discovered.get(name);
    if (!workspacePackage) fail(`Required OPC Pi workspace package is missing: ${name}`);
    selected.set(name, workspacePackage);

    for (const dependencies of [
      workspacePackage.manifest.dependencies,
      workspacePackage.manifest.optionalDependencies,
    ]) {
      for (const dependencyName of Object.keys(dependencies ?? {})) {
        if (dependencyName.startsWith(piPackagePrefix) && discovered.has(dependencyName)) {
          queue.push(dependencyName);
        }
      }
    }
  }

  return [...selected.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function verifyManifestSourceBindings(packages) {
  const manifest = projectManifest();
  for (const packageName of directPiDependencies(manifest)) {
    if (!String(manifest.dependencies?.[packageName] ?? "").startsWith("file:")) {
      fail(`Direct Pi dependency must use an OPC file: source binding: ${packageName}`);
    }
  }
  for (const workspacePackage of packages) {
    if (!String(manifest.overrides?.[workspacePackage.name] ?? "").startsWith("file:")) {
      fail(
        `OPC runtime package is missing a file: override: ${workspacePackage.name}. ` +
          "Add its workspace path to package.json and regenerate both lockfiles.",
      );
    }
  }
}

function packageEntryPath(workspacePackage) {
  const rootExport = workspacePackage.manifest.exports?.["."];
  const exportedEntry = typeof rootExport === "string" ? rootExport : rootExport?.import;
  const entry = exportedEntry ?? workspacePackage.manifest.main;
  if (typeof entry !== "string") fail(`Package has no import entry: ${workspacePackage.name}`);
  const entryPath = resolve(workspacePackage.directory, entry);
  if (!existsSync(entryPath)) {
    fail(`Built entry is missing for ${workspacePackage.name}: ${entryPath}. Run npm run pi:prepare.`);
  }
  return entryPath;
}

function hashDirectory(directory) {
  const hash = createHash("sha256");
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const entryPath = join(current, entry.name);
      const relativePath = relative(directory, entryPath);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile()) {
        hash.update(relativePath);
        hash.update("\0");
        hash.update(readFileSync(entryPath));
        hash.update("\0");
      }
    }
  };
  visit(directory);
  return hash.digest("hex");
}

function sourceFingerprint(sourceRoot, commit) {
  const hash = createHash("sha256");
  hash.update(commit);
  hash.update("\0");
  hash.update(runGit(sourceRoot, ["diff", "--binary", "--no-ext-diff", "HEAD", "--", "."]));

  const untrackedOutput = runGit(sourceRoot, ["ls-files", "--others", "--exclude-standard"]);
  const untrackedPaths = untrackedOutput.split("\n").filter(Boolean).sort();
  for (const path of untrackedPaths) {
    const absolutePath = join(sourceRoot, path);
    hash.update(path);
    hash.update("\0");
    if (existsSync(absolutePath) && statSync(absolutePath).isFile()) hash.update(readFileSync(absolutePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function gitState(sourceRoot) {
  const commit = runGit(sourceRoot, ["rev-parse", "HEAD"]).trim();
  const shortCommit = runGit(sourceRoot, ["rev-parse", "--short=12", "HEAD"]).trim();
  const dirty = runGit(sourceRoot, ["status", "--porcelain"]).trim().length > 0;
  return {
    commit,
    shortCommit,
    dirty,
    fingerprint: sourceFingerprint(sourceRoot, commit),
  };
}

function resolveSource() {
  const configuredRoot = configuredSourceRoot();
  if (!existsSync(configuredRoot)) {
    fail(`OPC Pi source directory not found: ${configuredRoot}. Set PI_WEB_PI_SOURCE_DIR if it lives elsewhere.`);
  }
  const sourceRoot = realpathSync(configuredRoot);
  if (!existsSync(join(sourceRoot, ".git")) && !runGit(sourceRoot, ["rev-parse", "--is-inside-work-tree"]).trim()) {
    fail(`OPC Pi source is not a Git worktree: ${sourceRoot}`);
  }
  const discovered = discoverWorkspacePackages(sourceRoot);
  const packages = runtimePackageClosure(discovered);
  verifyManifestSourceBindings(packages);
  return { configuredRoot, sourceRoot, packages };
}

function buildSource(sourceRoot) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["run", "build:offline"], {
    cwd: sourceRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) fail(`OPC Pi build failed with exit code ${result.status ?? "unknown"}`);
}

function targetPackagePath(packageName) {
  const unscopedName = packageName.slice("@earendil-works/".length);
  const target = join(packageScopeDir, unscopedName);
  const relativeTarget = relative(packageScopeDir, target);
  if (!relativeTarget || relativeTarget.startsWith("..") || relativeTarget.includes(sep)) {
    fail(`Refusing unsafe package target: ${target}`);
  }
  return target;
}

function inspectPackages(packages) {
  return packages.map((workspacePackage) => {
    const entryPath = packageEntryPath(workspacePackage);
    const distDir = join(workspacePackage.directory, "dist");
    if (!existsSync(distDir)) fail(`Built dist directory is missing for ${workspacePackage.name}: ${distDir}`);
    return {
      name: workspacePackage.name,
      version: workspacePackage.manifest.version ?? "unknown",
      sourceDirectory: realpathSync(workspacePackage.directory),
      entryRelativePath: relative(workspacePackage.directory, entryPath),
      distSha256: hashDirectory(distDir),
    };
  });
}

function writeState(sourceRoot, git, packages) {
  mkdirSync(dirname(statePath), { recursive: true });
  const state = {
    schemaVersion: 1,
    mode: "opc-source",
    generatedAt: new Date().toISOString(),
    sourceRoot,
    git,
    packages,
  };
  const temporaryPath = `${statePath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, statePath);
  return state;
}

function linkPackages(sourceRoot, packages) {
  const inspectedPackages = inspectPackages(packages);
  mkdirSync(packageScopeDir, { recursive: true });

  for (const workspacePackage of inspectedPackages) {
    const target = targetPackagePath(workspacePackage.name);
    const temporaryLink = `${target}.pi-source-${process.pid}`;
    rmSync(temporaryLink, { recursive: true, force: true });
    symlinkSync(workspacePackage.sourceDirectory, temporaryLink, process.platform === "win32" ? "junction" : "dir");
    rmSync(target, { recursive: true, force: true });
    renameSync(temporaryLink, target);
  }

  const git = gitState(sourceRoot);
  return writeState(sourceRoot, git, inspectedPackages);
}

function compatibilityWarnings(state) {
  const manifest = readJson(join(projectRoot, "package.json"));
  const warnings = [];
  for (const packageState of state.packages) {
    const requested = manifest.dependencies?.[packageState.name];
    if (typeof requested === "string" && /^\d+\.\d+\.\d+$/.test(requested) && requested !== packageState.version) {
      warnings.push(`${packageState.name}: Pi Web declares ${requested}, OPC source reports ${packageState.version}`);
    }
  }
  return warnings;
}

function verifyBinding({ production = false, quiet = false } = {}) {
  if (!existsSync(statePath)) fail(`OPC Pi source state is missing: ${statePath}. Run npm run pi:prepare.`);
  const state = readJson(statePath);
  if (state.schemaVersion !== 1 || state.mode !== "opc-source") fail(`Invalid OPC Pi source state: ${statePath}`);

  const resolved = resolveSource();
  if (resolved.sourceRoot !== state.sourceRoot) {
    fail(`OPC Pi source changed from ${state.sourceRoot} to ${resolved.sourceRoot}. Run npm run pi:prepare.`);
  }

  const currentGit = gitState(resolved.sourceRoot);
  if (currentGit.fingerprint !== state.git?.fingerprint) {
    fail("OPC Pi source changed after its Pi Web binding was prepared. Run npm run pi:prepare again.");
  }
  if (production && currentGit.dirty) fail("Production requires a clean OPC Pi source worktree.");

  const expectedNames = resolved.packages.map((entry) => entry.name).sort();
  const stateNames = (state.packages ?? []).map((entry) => entry.name).sort();
  if (JSON.stringify(expectedNames) !== JSON.stringify(stateNames)) {
    fail("OPC Pi runtime package closure changed. Run npm run pi:prepare again.");
  }

  for (const packageState of state.packages) {
    const target = targetPackagePath(packageState.name);
    if (!existsSync(target) && !lstatSync(target, { throwIfNoEntry: false })) fail(`Pi Web package link is missing: ${target}`);
    if (!lstatSync(target).isSymbolicLink()) fail(`Pi Web package is not linked to OPC source: ${target}`);
    if (realpathSync(target) !== packageState.sourceDirectory) {
      fail(`Pi Web package resolves outside the prepared OPC source: ${packageState.name}`);
    }
    const manifest = readJson(join(target, "package.json"));
    if ((manifest.version ?? "unknown") !== packageState.version) {
      fail(`OPC package version changed after prepare: ${packageState.name}`);
    }
    const distDir = join(target, "dist");
    if (!existsSync(join(target, packageState.entryRelativePath))) {
      fail(`OPC package entry is missing after prepare: ${packageState.name}`);
    }
    if (hashDirectory(distDir) !== packageState.distSha256) {
      fail(`OPC package build output changed after prepare: ${packageState.name}`);
    }
  }

  const warnings = compatibilityWarnings(state);
  if (!quiet) {
    console.log(`OPC Pi source: ${state.git.shortCommit}${state.git.dirty ? " (dirty)" : ""}`);
    console.log(`Runtime packages: ${state.packages.length} linked from ${state.sourceRoot}`);
    for (const warning of warnings) console.warn(`Compatibility warning: ${warning}`);
  }
  return { state, warnings };
}

function printPrepared(state) {
  console.log(`Prepared OPC Pi source ${state.git.shortCommit}${state.git.dirty ? " (dirty)" : ""}`);
  for (const packageState of state.packages) {
    console.log(`  ${packageState.name}@${packageState.version} -> ${packageState.sourceDirectory}`);
  }
}

function usage() {
  console.error("Usage: node scripts/pi-source.mjs <prepare|build|link|verify> [--production]");
}

try {
  const command = process.argv[2];
  const production = process.argv.includes("--production");
  if (!command || !["prepare", "build", "link", "verify"].includes(command)) {
    usage();
    process.exitCode = 2;
  } else {
    const resolved = resolveSource();
    if (command === "build" || command === "prepare") buildSource(resolved.sourceRoot);
    if (command === "link" || command === "prepare") {
      const refreshed = resolveSource();
      const state = linkPackages(refreshed.sourceRoot, refreshed.packages);
      printPrepared(state);
    }
    if (command === "verify" || command === "prepare") verifyBinding({ production });
  }
} catch (error) {
  console.error(`OPC Pi source error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
