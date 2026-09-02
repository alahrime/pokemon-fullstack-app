/**
 * The rules module's public surface.
 *
 * UI code imports from here and never from the files behind it, so the internal
 * layout can change without a hundred import rewrites — and so the one rule
 * that matters about this directory stays checkable: nothing in it may import
 * React or touch a browser API. It has to run unchanged under Node, because the
 * server will eventually validate teams with exactly this code, and a validator
 * that disagrees with the client is worse than no validator.
 */
export { canonicalize } from './canonical';
export { rulesHash } from './hash';
export { compileSelector, type RefTerm } from './selector';
export { compileBuildSelector, type BuildTerm } from './buildSelector';
export { resolvePool, type PoolResolution } from './pool';
export { validateTeam, type TeamCheck } from './team';
export {
  lintFormat,
  findSatisfyingTeam,
  MIN_POOL_ABSOLUTE,
  NARROW_POOL_FRACTION,
  RANDOM_POOL_MULTIPLE,
  SEARCH_NODE_BUDGET,
} from './lint';
export { rollTeam } from './roll';
export { typesOn, toggleType, addSpecies, removeRef, type SpeciesScope } from './edits';
export * from './types';
