export { createBlizzardClient } from "./client";
export type {
  BlizzardClient,
  BlizzardClientOptions,
  Region,
  NamespaceCategory,
} from "./client";
export { TokenManager } from "./auth";
export type { OAuthOptions } from "./auth";

/** Generated OpenAPI types (paths / components / operations) for advanced use. */
export type { paths, components, operations } from "./generated/schema";
