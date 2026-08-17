import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";

type PiSourcePackageState = {
  name: string;
  version: string;
  sourceDirectory: string;
  entryRelativePath: string;
};

type PiSourceState = {
  schemaVersion: number;
  mode: "opc-source";
  sourceRoot: string;
  git: {
    commit: string;
    shortCommit: string;
    dirty: boolean;
  };
  packages: PiSourcePackageState[];
};

export type PiSourcePublicInfo = {
  mode: "opc-source";
  version: string;
  commit: string;
  dirty: boolean;
  packageCount: number;
};

function statePath(projectRoot: string): string {
  return join(projectRoot, "node_modules", ".pi-web-source.json");
}

function readState(projectRoot: string): PiSourceState {
  const path = statePath(projectRoot);
  if (!existsSync(path)) throw new Error(`OPC Pi source state is missing: ${path}. Run npm run pi:prepare.`);
  const state = JSON.parse(readFileSync(path, "utf8")) as PiSourceState;
  if (state.schemaVersion !== 1 || state.mode !== "opc-source" || !Array.isArray(state.packages)) {
    throw new Error(`Invalid OPC Pi source state: ${path}`);
  }
  return state;
}

function packageTarget(projectRoot: string, packageName: string): string {
  const prefix = "@earendil-works/";
  if (!packageName.startsWith(`${prefix}pi-`)) throw new Error(`Invalid OPC Pi package name: ${packageName}`);
  const target = join(projectRoot, "node_modules", "@earendil-works", packageName.slice(prefix.length));
  const scopeRoot = join(projectRoot, "node_modules", "@earendil-works");
  const relativeTarget = relative(scopeRoot, target);
  if (!relativeTarget || relativeTarget.startsWith("..") || relativeTarget.includes(sep)) {
    throw new Error(`Unsafe OPC Pi package target: ${target}`);
  }
  return target;
}

export function assertPiSourceRuntime(projectRoot: string = process.cwd()): PiSourceState {
  const state = readState(projectRoot);
  for (const packageState of state.packages) {
    const target = packageTarget(projectRoot, packageState.name);
    if (!existsSync(target) || !lstatSync(target).isSymbolicLink()) {
      throw new Error(`Pi Web must load ${packageState.name} from OPC source; run npm run pi:prepare.`);
    }
    if (realpathSync(target) !== packageState.sourceDirectory) {
      throw new Error(`Pi Web resolved ${packageState.name} outside the prepared OPC source.`);
    }
    if (!existsSync(join(target, packageState.entryRelativePath))) {
      throw new Error(`OPC Pi build output is missing for ${packageState.name}; run npm run pi:prepare.`);
    }
  }
  return state;
}

export function getPiSourcePublicInfo(projectRoot: string = process.cwd()): PiSourcePublicInfo {
  const state = assertPiSourceRuntime(projectRoot);
  const codingAgent = state.packages.find((entry) => entry.name === "@earendil-works/pi-coding-agent");
  if (!codingAgent) throw new Error("OPC Pi source state does not include pi-coding-agent.");
  return {
    mode: state.mode,
    version: codingAgent.version,
    commit: state.git.shortCommit,
    dirty: state.git.dirty,
    packageCount: state.packages.length,
  };
}
