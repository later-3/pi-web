import type { ResourceDiagnostic } from "@earendil-works/pi-coding-agent";

export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
}

export type SkillInstallScope = "global" | "project";

export interface SkillInstallInfo {
  package: string;
  scope: SkillInstallScope;
  source: string;
  sourceType?: string;
  skillsShUrl?: string;
  skillPath?: string;
  ref?: string;
  versionHash?: string;
  canCheckForUpdates: boolean;
}

export type SkillUpdateState =
  | "up-to-date"
  | "update-available"
  | "unsupported"
  | "error";

export interface SkillUpdateResult {
  package: string;
  scope: SkillInstallScope;
  state: SkillUpdateState;
  currentVersion?: string;
  latestVersion?: string;
  message?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo: {
    source?: string;
    scope?: string;
  };
  install?: SkillInstallInfo;
}

export interface SkillsResponse {
  skills: SkillInfo[];
  diagnostics: ResourceDiagnostic[];
  projectResourcesLoaded: boolean;
}

export interface ProjectTrustStatus {
  requiresTrust: boolean;
  trusted: boolean;
}

export interface AppUpdateResponse {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
}

export type PluginScope = "global" | "project";
export type PluginResourceKind = "extension" | "skill" | "prompt" | "theme";

export interface PluginResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

export interface PluginDiagnostic {
  type: "warning" | "error";
  message: string;
  source?: string;
  path?: string;
}

export interface PluginResourceInfo {
  kind: PluginResourceKind;
  name: string;
  path: string;
  relativePath: string;
}

export interface PluginPackageInfo {
  source: string;
  scope: PluginScope;
  filtered: boolean;
  disabled: boolean;
  installedPath?: string;
  packageName?: string;
  version?: string;
  configuredVersion?: string;
  counts: PluginResourceCounts;
  resources: PluginResourceInfo[];
  status: "loaded" | "installed" | "missing" | "disabled";
}

export interface PluginsResponse {
  packages: PluginPackageInfo[];
  totals: PluginResourceCounts;
  diagnostics: PluginDiagnostic[];
  projectResourcesLoaded: boolean;
}

// ── Extensions (file-level pi extensions, global toggle) ──

export type ExtensionScope = "global" | "project";
export type ExtensionOrigin = "file" | "package";

export interface ExtensionInfo {
  /** Full filesystem path of the active .ts/.js file (or the would-be path if disabled). */
  path: string;
  /** Display name derived from file/dir name. */
  name: string;
  scope: ExtensionScope;
  origin: ExtensionOrigin;
  /** metadata.source from pi: "local" | "cli" | "auto" | npm/git source. */
  source: string;
  /** True when the .ts/.js file exists and pi will load it. */
  enabled: boolean;
  /** Path of the .disabled file when currently disabled. */
  disabledPath?: string;
  /** Only single-file file-origin extensions can be toggled by rename. */
  canToggle: boolean;
  /** Disabled for the current session only (per-session override). False/absent when no session context. */
  sessionDisabled?: boolean;
}

export interface ExtensionsResponse {
  extensions: ExtensionInfo[];
  errors: Array<{ path: string; error: string }>;
}

// ── Provider request review payloads ──

export interface ProviderRequestSummary {
  file: string;
  path: string;
  mtime: number;
  size: number;
  model?: string;
  messageCount: number;
  toolCount: number;
}

export interface ProviderRequestsResponse {
  requests: ProviderRequestSummary[];
  dir: string;
}

export interface ProviderRequestDetail {
  file: string;
  path: string;
  payload: unknown;
  summary: {
    model?: string;
    messageCount: number;
    toolCount: number;
    maxTokens?: number;
    reasoningEffort?: string;
    thinking?: unknown;
    stream?: boolean;
    roles: Record<string, number>;
  };
}
