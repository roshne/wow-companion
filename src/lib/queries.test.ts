import { describe, it, expect, vi } from "vitest";
import {
  BnetError,
  unwrap,
  describeError,
  queryKeys,
  fetchTokenIndex,
  fetchConnectedRealms,
  fetchCharacter,
  fetchCharacterAvatar,
  tokenQuery,
  connectedRealmsQuery,
  characterQuery,
  characterAvatarQuery,
  fetchRealmIndex,
  realmIndexQuery,
} from "./queries";
import { mockBnet, mockResponse } from "../test/mocks";

describe("unwrap", () => {
  it("returns the data for an OK response", () => {
    expect(unwrap({ price: 10 }, mockResponse(200))).toEqual({ price: 10 });
  });

  it("throws a BnetError carrying the status for a non-OK response", () => {
    expect(() => unwrap(undefined, mockResponse(500))).toThrow(BnetError);
    try {
      unwrap(undefined, mockResponse(503));
    } catch (e) {
      expect((e as BnetError).status).toBe(503);
    }
  });

  it("throws when the body is undefined even on a 200", () => {
    try {
      unwrap(undefined, mockResponse(200));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BnetError);
      expect((e as BnetError).status).toBe(200);
    }
  });

  it("parses a numeric Retry-After header onto the error", () => {
    try {
      unwrap(undefined, mockResponse(429, { "Retry-After": "12" }));
    } catch (e) {
      expect((e as BnetError).status).toBe(429);
      expect((e as BnetError).retryAfter).toBe(12);
    }
  });

  it("parses an HTTP-date Retry-After to seconds-from-now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2015-10-21T07:00:00Z"));
    try {
      unwrap(undefined, mockResponse(429, { "Retry-After": "Wed, 21 Oct 2015 07:28:00 GMT" }));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as BnetError).retryAfter).toBe(28 * 60);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps a past HTTP-date Retry-After to 0", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2015-10-21T07:30:00Z"));
    try {
      unwrap(undefined, mockResponse(429, { "Retry-After": "Wed, 21 Oct 2015 07:28:00 GMT" }));
    } catch (e) {
      expect((e as BnetError).retryAfter).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves retryAfter null for an unparseable Retry-After", () => {
    try {
      unwrap(undefined, mockResponse(429, { "Retry-After": "soon-ish" }));
    } catch (e) {
      expect((e as BnetError).retryAfter).toBeNull();
    }
  });
});

describe("describeError", () => {
  it("formats a BnetError with its status", () => {
    expect(describeError(new BnetError(404))).toBe("Failed (HTTP 404).");
  });

  it("stringifies any other error", () => {
    expect(describeError(new Error("boom"))).toBe("Error: Error: boom");
  });
});

describe("queryKeys", () => {
  it("puts the region first in every key", () => {
    expect(queryKeys.token("us")).toEqual(["token", "us"]);
    expect(queryKeys.connectedRealms("eu")).toEqual(["connected-realms", "eu"]);
    expect(queryKeys.character("kr", "tichondrius", "asmon")).toEqual([
      "character",
      "kr",
      "tichondrius",
      "asmon",
    ]);
    expect(queryKeys.characterMedia("tw", "tichondrius", "asmon")).toEqual([
      "character-media",
      "tw",
      "tichondrius",
      "asmon",
    ]);
  });
});

describe("fetchTokenIndex", () => {
  it("requests the dynamic namespace and returns the body", async () => {
    const { bnet, get } = mockBnet("us");
    get.mockResolvedValue({ data: { price: 2_500_000 }, response: mockResponse(200) });
    const data = await fetchTokenIndex(bnet);
    expect(data).toEqual({ price: 2_500_000 });
    expect(get).toHaveBeenCalledWith("/data/wow/token/index", {
      params: { query: { namespace: "dynamic-us", locale: "en_US" } },
    });
  });

  it("throws on a non-OK response", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: undefined, response: mockResponse(500) });
    await expect(fetchTokenIndex(bnet)).rejects.toBeInstanceOf(BnetError);
  });
});

describe("fetchConnectedRealms", () => {
  it("follows pagination and concatenates every page's results", async () => {
    const { bnet, get } = mockBnet("us");
    get
      .mockResolvedValueOnce({
        data: { pageCount: 2, results: [{ data: { id: 1 } }] },
        response: mockResponse(200),
      })
      .mockResolvedValueOnce({
        data: { pageCount: 2, results: [{ data: { id: 2 } }] },
        response: mockResponse(200),
      });
    const rows = await fetchConnectedRealms(bnet);
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0][1].params.query._page).toBe(1);
    expect(get.mock.calls[1][1].params.query._page).toBe(2);
  });

  it("throws when a page comes back non-OK", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: undefined, response: mockResponse(503) });
    await expect(fetchConnectedRealms(bnet)).rejects.toBeInstanceOf(BnetError);
  });
});

describe("fetchCharacter", () => {
  it("requests the profile namespace with the path params and returns the body", async () => {
    const { bnet, get } = mockBnet("eu");
    get.mockResolvedValue({ data: { name: "Asmon" }, response: mockResponse(200) });
    const data = await fetchCharacter(bnet, "tichondrius", "asmon");
    expect(data).toEqual({ name: "Asmon" });
    expect(get).toHaveBeenCalledWith("/profile/wow/character/{realmSlug}/{characterName}", {
      params: {
        path: { realmSlug: "tichondrius", characterName: "asmon" },
        query: { namespace: "profile-eu", locale: "en_US" },
      },
    });
  });

  it("throws a BnetError(404) for a missing character", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: undefined, response: mockResponse(404) });
    await expect(fetchCharacter(bnet, "nope", "ghost")).rejects.toMatchObject({ status: 404 });
  });
});

describe("fetchCharacterAvatar", () => {
  it("returns the avatar asset value when present", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({
      data: { assets: [{ key: "avatar", value: "http://img/a.jpg" }] },
      response: mockResponse(200),
    });
    await expect(fetchCharacterAvatar(bnet, "r", "n")).resolves.toBe("http://img/a.jpg");
  });

  it("returns null when there is no avatar asset", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({
      data: { assets: [{ key: "main", value: "x" }] },
      response: mockResponse(200),
    });
    await expect(fetchCharacterAvatar(bnet, "r", "n")).resolves.toBeNull();
  });

  it("returns null (best-effort) on a non-OK response instead of throwing", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: undefined, response: mockResponse(404) });
    await expect(fetchCharacterAvatar(bnet, "r", "n")).resolves.toBeNull();
  });
});

describe("fetchRealmIndex", () => {
  it("requests the dynamic namespace and returns name/slug entries sorted by name", async () => {
    const { bnet, get } = mockBnet("us");
    get.mockResolvedValue({
      data: {
        realms: [
          { name: "Zul'jin", slug: "zuljin", id: 3 },
          { name: "Area 52", slug: "area-52", id: 2 },
        ],
      },
      response: mockResponse(200),
    });
    const realms = await fetchRealmIndex(bnet);
    expect(realms).toEqual([
      { name: "Area 52", slug: "area-52" },
      { name: "Zul'jin", slug: "zuljin" },
    ]);
    expect(get).toHaveBeenCalledWith("/data/wow/realm/index", {
      params: { query: { namespace: "dynamic-us", locale: "en_US" } },
    });
  });

  it("drops entries missing a name or slug", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({
      data: { realms: [{ name: "Good", slug: "good" }, { slug: "no-name" }, { name: "No Slug" }] },
      response: mockResponse(200),
    });
    await expect(fetchRealmIndex(bnet)).resolves.toEqual([{ name: "Good", slug: "good" }]);
  });

  it("throws on a non-OK response", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: undefined, response: mockResponse(500) });
    await expect(fetchRealmIndex(bnet)).rejects.toBeInstanceOf(BnetError);
  });
});

describe("query-option factories", () => {
  it("carry the region-scoped key and per-endpoint staleTime", () => {
    const { bnet } = mockBnet("kr");
    expect(tokenQuery(bnet).queryKey).toEqual(["token", "kr"]);
    expect(tokenQuery(bnet).staleTime).toBe(5 * 60_000);
    expect(connectedRealmsQuery(bnet).queryKey).toEqual(["connected-realms", "kr"]);
    expect(connectedRealmsQuery(bnet).staleTime).toBe(5 * 60_000);
    expect(characterQuery(bnet, "r", "n").queryKey).toEqual(["character", "kr", "r", "n"]);
    expect(characterQuery(bnet, "r", "n").staleTime).toBe(60_000);
    expect(characterAvatarQuery(bnet, "r", "n").queryKey).toEqual([
      "character-media",
      "kr",
      "r",
      "n",
    ]);
    expect(characterAvatarQuery(bnet, "r", "n").staleTime).toBe(30 * 60_000);
    expect(realmIndexQuery(bnet).queryKey).toEqual(["realm-index", "kr"]);
    expect(realmIndexQuery(bnet).staleTime).toBe(60 * 60_000);
  });

  it("wire a queryFn that hits the client", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: { price: 1 }, response: mockResponse(200) });
    const queryFn = tokenQuery(bnet).queryFn as (ctx: unknown) => Promise<unknown>;
    await queryFn({});
    expect(get).toHaveBeenCalledOnce();
  });
});
