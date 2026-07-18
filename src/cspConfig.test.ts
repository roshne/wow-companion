import { describe, it, expect } from "vitest";
import tauriConf from "../src-tauri/tauri.conf.json";

// Guards the webview Content-Security-Policy contract so it can't silently regress to `null`
// (wide open) or drop a source the app actually depends on. Runtime "no CSP violations in any
// view" is verified manually against the packaged desktop app (issue #47) — here we assert the
// policy is present and coherent so a stray edit can't reopen the webview.
//
// Architecture note: almost no traffic touches the webview — OAuth is Rust/reqwest and every
// data-API call is proxied through the HTTP plugin over IPC to Rust, so the Blizzard API hosts
// live in capabilities/default.json (the plugin-http allowlist), NOT in `connect-src`. The only
// direct webview remote load is the character render `<img>`, which is what `img-src` covers.
describe("csp config", () => {
  const security = tauriConf.app.security;
  const csp = security.csp as Record<string, string> | null;
  const devCsp = security.devCsp as Record<string, string> | null;

  it("sets an explicit CSP (not null / disabled)", () => {
    expect(csp).not.toBeNull();
    expect(typeof csp).toBe("object");
  });

  it("locks the default fallback to self", () => {
    expect(csp?.["default-src"]).toBe("'self'");
  });

  it("allows the character render host in img-src", () => {
    const imgSrc = csp?.["img-src"] ?? "";
    expect(imgSrc).toContain("'self'");
    expect(imgSrc).toContain("https://*.worldofwarcraft.com");
  });

  it("keeps the Tauri IPC bridge in connect-src (invoke + http plugin)", () => {
    const connectSrc = csp?.["connect-src"] ?? "";
    expect(connectSrc).toContain("'self'");
    expect(connectSrc).toContain("ipc:");
    expect(connectSrc).toContain("http://ipc.localhost");
  });

  it("does not route the Blizzard API through the webview connect-src", () => {
    // These hosts are reached from Rust, so they belong in capabilities/default.json, not the CSP.
    const connectSrc = csp?.["connect-src"] ?? "";
    expect(connectSrc).not.toContain("api.blizzard.com");
    expect(connectSrc).not.toContain("oauth.battle.net");
  });

  it("restricts script-src to self with no eval", () => {
    const scriptSrc = csp?.["script-src"] ?? "";
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("allows inline styles for React's style props", () => {
    const styleSrc = csp?.["style-src"] ?? "";
    expect(styleSrc).toContain("'self'");
    expect(styleSrc).toContain("'unsafe-inline'");
  });

  it("hardens object-src and base-uri", () => {
    expect(csp?.["object-src"]).toBe("'none'");
    expect(csp?.["base-uri"]).toBe("'self'");
  });

  it("relaxes the dev CSP so Vite dev + HMR still work", () => {
    expect(devCsp).not.toBeNull();
    // React-Refresh injects an inline preamble script in dev.
    expect(devCsp?.["script-src"]).toContain("'unsafe-inline'");
    // Vite dev server + HMR websocket on localhost.
    const connectSrc = devCsp?.["connect-src"] ?? "";
    expect(connectSrc).toContain("ws://localhost:*");
    expect(connectSrc).toContain("http://localhost:*");
    // Dev must not be looser than prod on the img host.
    expect(devCsp?.["img-src"]).toContain("https://*.worldofwarcraft.com");
  });
});
