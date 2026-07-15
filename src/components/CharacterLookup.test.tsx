import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { CharacterLookup } from "./CharacterLookup";
import { renderWithClient } from "../test/utils";
import { mockBnet, mockResponse } from "../test/mocks";

const MEDIA_PATH = "/profile/wow/character/{realmSlug}/{characterName}/character-media";

function fillAndSubmit(realm: string, name: string) {
  fireEvent.change(screen.getByPlaceholderText(/Realm/), { target: { value: realm } });
  fireEvent.change(screen.getByPlaceholderText("Character name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: /look up/i }));
}

describe("CharacterLookup", () => {
  it("validates empty input without hitting the API", () => {
    const { bnet, get } = mockBnet();
    renderWithClient(<CharacterLookup bnet={bnet} />);

    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
    expect(screen.getByText("Enter a realm and character name.")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
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
});
