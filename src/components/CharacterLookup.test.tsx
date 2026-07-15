import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { CharacterLookup } from "./CharacterLookup";
import { renderWithClient } from "../test/utils";
import { mockBnet, mockResponse } from "../test/mocks";
import { addRecentCharacter, toggleFavoriteCharacter } from "../lib/persist";

const MEDIA_PATH = "/profile/wow/character/{realmSlug}/{characterName}/character-media";

function fillAndSubmit(realm: string, name: string) {
  fireEvent.change(screen.getByPlaceholderText(/Realm/), { target: { value: realm } });
  fireEvent.change(screen.getByPlaceholderText("Character name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: /look up/i }));
}

describe("CharacterLookup", () => {
  beforeEach(() => localStorage.clear());

  it("validates empty input without looking up a character", () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: { realms: [] }, response: mockResponse(200) });
    renderWithClient(<CharacterLookup bnet={bnet} />);

    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
    expect(screen.getByText("Enter a realm and character name.")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith(
      "/profile/wow/character/{realmSlug}/{characterName}",
      expect.anything(),
    );
  });

  it("looks up a character and then fetches the avatar as a dependent query", async () => {
    const { bnet, get } = mockBnet();
    get.mockImplementation((path: string) => {
      if (path === MEDIA_PATH) {
        return Promise.resolve({
          data: { assets: [{ key: "avatar", value: "http://img/a.jpg" }] },
          response: mockResponse(200),
        });
      }
      return Promise.resolve({
        data: { name: "Asmon", level: 70, realm: { name: "Tichondrius" } },
        response: mockResponse(200),
      });
    });
    const { container } = renderWithClient(<CharacterLookup bnet={bnet} />);

    fillAndSubmit("Tichondrius", "Asmon");

    await waitFor(() => expect(screen.getByText("Asmon")).toBeInTheDocument());
    // Avatar query only fires after the character query succeeds.
    await waitFor(() => expect(get).toHaveBeenCalledWith(MEDIA_PATH, expect.anything()));
    await waitFor(() =>
      expect(container.querySelector("img.avatar")).toHaveAttribute("src", "http://img/a.jpg"),
    );
  });

  it("shows a not-found message on a 404", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: undefined, response: mockResponse(404) });
    renderWithClient(<CharacterLookup bnet={bnet} />);

    fillAndSubmit("Nope", "Ghost");
    await waitFor(() =>
      expect(
        screen.getByText("Character not found — check the realm slug and name."),
      ).toBeInTheDocument(),
    );
  });

  it("records a successful lookup in the recents list", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: { name: "Asmon", level: 70 }, response: mockResponse(200) });
    renderWithClient(<CharacterLookup bnet={bnet} />);

    fillAndSubmit("Tichondrius", "Asmon");
    await screen.findByRole("button", { name: "Asmon · Tichondrius" });
  });

  it("re-runs the lookup when a recent chip is clicked", async () => {
    addRecentCharacter({ region: "us", realmSlug: "tichondrius", characterName: "asmon" });
    const { bnet, get } = mockBnet("us");
    get.mockResolvedValue({ data: { name: "Asmon", level: 70 }, response: mockResponse(200) });
    renderWithClient(<CharacterLookup bnet={bnet} />);

    fireEvent.click(await screen.findByRole("button", { name: "Asmon · Tichondrius" }));
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        "/profile/wow/character/{realmSlug}/{characterName}",
        expect.objectContaining({
          params: expect.objectContaining({
            path: { realmSlug: "tichondrius", characterName: "asmon" },
          }),
        }),
      ),
    );
    await screen.findByRole("heading", { name: /Asmon/ });
  });

  it("shows only recents for the current region", () => {
    addRecentCharacter({ region: "eu", realmSlug: "silvermoon", characterName: "bob" });
    const { bnet, get } = mockBnet("us");
    get.mockResolvedValue({ data: { realms: [] }, response: mockResponse(200) });
    renderWithClient(<CharacterLookup bnet={bnet} />);

    expect(screen.queryByRole("button", { name: /Bob/ })).toBeNull();
  });

  it("populates the realm autocomplete from the realm index", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({
      data: {
        realms: [
          { name: "Tichondrius", slug: "tichondrius" },
          { name: "Area 52", slug: "area-52" },
        ],
      },
      response: mockResponse(200),
    });
    const { container } = renderWithClient(<CharacterLookup bnet={bnet} />);

    await waitFor(() =>
      expect(container.querySelectorAll("#realm-options option")).toHaveLength(2),
    );
    const values = Array.from(
      container.querySelectorAll<HTMLOptionElement>("#realm-options option"),
    ).map((o) => o.value);
    expect(values).toEqual(["Area 52", "Tichondrius"]);
    expect(screen.getByPlaceholderText(/Realm/).getAttribute("list")).toBe("realm-options");
  });

  it("stars a looked-up character into the favorites strip", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: { name: "Asmon", level: 70 }, response: mockResponse(200) });
    renderWithClient(<CharacterLookup bnet={bnet} />);

    fillAndSubmit("Tichondrius", "Asmon");
    fireEvent.click(await screen.findByRole("button", { name: /☆ Favorite/ }));

    expect(screen.getByRole("button", { name: /★ Favorited/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "★ Asmon · Tichondrius" })).toBeInTheDocument();
  });

  it("removes a favorite from the strip", () => {
    toggleFavoriteCharacter({ region: "us", realmSlug: "tichondrius", characterName: "asmon" });
    const { bnet, get } = mockBnet("us");
    get.mockResolvedValue({ data: { realms: [] }, response: mockResponse(200) });
    renderWithClient(<CharacterLookup bnet={bnet} />);

    expect(screen.getByRole("button", { name: "★ Asmon · Tichondrius" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove asmon from favorites" }));
    expect(screen.queryByRole("button", { name: "★ Asmon · Tichondrius" })).toBeNull();
  });
});
