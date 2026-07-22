import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { GuildLookup } from "./GuildLookup";
import { renderWithClient } from "../test/utils";
import { mockBnet, mockResponse } from "../test/mocks";
import { FACTION_COLORS } from "../lib/wow";

const GUILD_PATH = "/data/wow/guild/{realmSlug}/{nameSlug}";
const ROSTER_PATH = "/data/wow/guild/{realmSlug}/{nameSlug}/roster";
const REALM_INDEX_PATH = "/data/wow/realm/index";

const SUMMARY = {
  name: "Complexity Limit",
  faction: { type: "HORDE", name: "Horde" },
  member_count: 137,
  achievement_points: 4285,
  realm: { name: "Illidan", slug: "illidan" },
  created_timestamp: 0,
};

/** Route `api.GET` by path: guild summary, roster, realm index. */
function routeGuild(
  get: ReturnType<typeof mockBnet>["get"],
  opts: {
    summary?: unknown;
    summaryStatus?: number;
    realms?: { name: string; slug: string }[];
  } = {},
) {
  get.mockImplementation((path: string) => {
    if (path === GUILD_PATH) {
      const status = opts.summaryStatus ?? 200;
      return Promise.resolve({
        data: status === 200 ? (opts.summary ?? SUMMARY) : undefined,
        response: mockResponse(status),
      });
    }
    if (path === ROSTER_PATH) {
      return Promise.resolve({ data: { members: [] }, response: mockResponse(200) });
    }
    if (path === REALM_INDEX_PATH) {
      return Promise.resolve({ data: { realms: opts.realms ?? [] }, response: mockResponse(200) });
    }
    return Promise.resolve({ data: {}, response: mockResponse(200) });
  });
}

function fillAndSubmit(realm: string, name: string) {
  fireEvent.change(screen.getByPlaceholderText(/Realm/), { target: { value: realm } });
  fireEvent.change(screen.getByPlaceholderText("Guild name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: /look up/i }));
}

describe("GuildLookup", () => {
  it("names both lookup fields, so they stay identifiable once typed into", () => {
    const { bnet, get } = mockBnet();
    routeGuild(get);
    renderWithClient(<GuildLookup bnet={bnet} />);

    // A placeholder is gone the moment the field has a value, so it can't be the only label.
    expect(screen.getByLabelText("Realm")).toBeInTheDocument();
    expect(screen.getByLabelText("Guild name")).toBeInTheDocument();
  });

  it("validates empty input without hitting the guild endpoint", () => {
    const { bnet, get } = mockBnet();
    routeGuild(get);
    renderWithClient(<GuildLookup bnet={bnet} />);

    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
    expect(screen.getByText("Enter a realm and guild name.")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith(GUILD_PATH, expect.anything());
  });

  it("looks up a guild and renders the summary card", async () => {
    const { bnet, get } = mockBnet();
    routeGuild(get);
    renderWithClient(<GuildLookup bnet={bnet} />);

    fillAndSubmit("Illidan", "Complexity Limit");

    await screen.findByRole("heading", { name: /Complexity Limit/ });
    expect(get).toHaveBeenCalledWith(
      GUILD_PATH,
      expect.objectContaining({
        params: expect.objectContaining({
          path: { realmSlug: "illidan", nameSlug: "complexity-limit" },
        }),
      }),
    );
    // Member count and achievement points are localized-formatted.
    expect(screen.getByText("137")).toBeInTheDocument();
    expect(screen.getByText("4,285")).toBeInTheDocument();
    // Faction is rendered in its faction colour.
    const faction = screen.getByText("Horde");
    expect(faction).toHaveStyle({ color: FACTION_COLORS.HORDE });
  });

  it("shows the roster sub-tabs on a successful lookup", async () => {
    const { bnet, get } = mockBnet();
    routeGuild(get);
    renderWithClient(<GuildLookup bnet={bnet} />);

    fillAndSubmit("Illidan", "Complexity Limit");
    await screen.findByRole("heading", { name: /Complexity Limit/ });
    expect(screen.getByRole("tab", { name: "Roster" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Achievements" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Activity" })).toBeInTheDocument();
  });

  it("shows a not-found message on a 404", async () => {
    const { bnet, get } = mockBnet();
    routeGuild(get, { summaryStatus: 404 });
    renderWithClient(<GuildLookup bnet={bnet} />);

    fillAndSubmit("Nope", "Ghost Guild");
    await waitFor(() =>
      expect(
        screen.getByText("Guild not found — check the realm and guild name."),
      ).toBeInTheDocument(),
    );
  });

  it("populates the realm autocomplete from the realm index", async () => {
    const { bnet, get } = mockBnet();
    routeGuild(get, {
      realms: [
        { name: "Tichondrius", slug: "tichondrius" },
        { name: "Area 52", slug: "area-52" },
      ],
    });
    const { container } = renderWithClient(<GuildLookup bnet={bnet} />);

    await waitFor(() =>
      expect(container.querySelectorAll("#guild-realm-options option")).toHaveLength(2),
    );
    expect(screen.getByPlaceholderText(/Realm/).getAttribute("list")).toBe("guild-realm-options");
  });

  it("surfaces an error (with retry) when the realm suggestions fail to load", async () => {
    const { bnet, get } = mockBnet();
    get.mockImplementation((path: string) =>
      path === REALM_INDEX_PATH
        ? Promise.resolve({ data: undefined, response: mockResponse(500) })
        : Promise.resolve({ data: SUMMARY, response: mockResponse(200) }),
    );
    renderWithClient(<GuildLookup bnet={bnet} />);

    expect(await screen.findByText("Couldn't load realm suggestions.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("submits the realm index's real slug when the typed realm matches (accents)", async () => {
    const { bnet, get } = mockBnet();
    get.mockImplementation((path: string) => {
      if (path === REALM_INDEX_PATH) {
        return Promise.resolve({
          data: { realms: [{ name: "Aggra (Português)", slug: "aggra-portugues" }] },
          response: mockResponse(200),
        });
      }
      if (path === ROSTER_PATH) {
        return Promise.resolve({ data: { members: [] }, response: mockResponse(200) });
      }
      return Promise.resolve({ data: SUMMARY, response: mockResponse(200) });
    });
    const { container } = renderWithClient(<GuildLookup bnet={bnet} />);

    await waitFor(() =>
      expect(container.querySelectorAll("#guild-realm-options option")).toHaveLength(1),
    );
    fillAndSubmit("Aggra (Português)", "Complexity Limit");

    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        GUILD_PATH,
        expect.objectContaining({
          params: expect.objectContaining({
            path: { realmSlug: "aggra-portugues", nameSlug: "complexity-limit" },
          }),
        }),
      ),
    );
  });
});
