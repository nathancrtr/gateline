export { type AdapterManifest, listAdapters, loadAdapterManifest, type ToolsStyle } from './adapter.ts'
export { runFork, runInit, runRender, runValidate } from './cli.ts'
export { type CopyManifest, loadCopyManifest, offered, resolveTake } from './copy-manifest.ts'
export {
  CI_WORKFLOW,
  detectAdapters,
  fork,
  type InitOptions,
  type InitResult,
  init,
  PROVENANCE_END,
  PROVENANCE_START,
  renderCheckWorkflow,
  repoSlug,
  sourceInfo,
  TOOL_VERSION,
  type ValidateResult,
  validate,
} from './integrate.ts'
export {
  type FrameworkLock,
  type Layout,
  LOCK_FILENAME,
  LOCK_REQUIRED_FIELDS,
  type LockFork,
  type LockSource,
  lockPath,
  type ProvenanceMode,
  readLock,
  serialiseLock,
} from './lock.ts'
export {
  mergeTools,
  overlaysFor,
  type RenderResult,
  renderAgent,
  renderAll,
  renderHeader,
} from './render.ts'
export { FrameworkError, parseList, parseRole, type RoleSpec, requireFrontmatter } from './role.ts'
export { coreRootFromLock, DEFAULT_FRAMEWORK_PREFIX, resolveCoreRoot } from './roots.ts'
