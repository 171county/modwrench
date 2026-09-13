// The adult-content policy moved to @modwrench/core when a second package
// (@modwrench/workbench) started querying Nexus through its own client and
// needed the same filter. One implementation, two callers.
//
// This file stays as a re-export so every import and test in this package keeps
// working against the same names.
export {
  adultContentAllowed,
  isAdult,
  filterAdultContent,
  applyAdultPolicy,
} from "@modwrench/core";
export type { FilterResult } from "@modwrench/core";
