/**
 * Search — re-exports from the modular src/search/ implementation.
 */
export {
  searchBlocks,
  searchBlocksAsync,
  blockDocs,
  messageDocs,
} from "./search/index.ts";
export {
  clearDocFeatures,
  docCacheInfo,
  docFeatures,
  setDocCacheCap,
} from "./search/index.ts";
export type { DocFeatures } from "./search/index.ts";
export type {
  SearchResult,
  SearchOptions,
  SearchAlgorithm,
  AsyncSearchAlgorithm,
  AnySearchAlgorithm,
  SearchDoc,
  SearchDocKind,
  ScoredBlock,
  MessageRole,
  RoleWeights,
  MessageInput,
} from "./search/types.ts";
export { DEFAULT_ALGORITHM, DEFAULT_ROLE_WEIGHTS } from "./search/types.ts";
export {
  registerSearchAlgorithm,
  getSearchAlgorithm,
  listSearchAlgorithms,
} from "./search/registry.ts";
