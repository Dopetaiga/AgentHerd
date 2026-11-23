import { expect, it } from "vitest";
import { checkedArchive } from "../scripts/fetch-dws.ts";

it("rejects a changed download before extracting it", async () => {
  const response = new Response(new Uint8Array([1, 2, 4]));
  await expect(
    checkedArchive(response, "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"),
  ).rejects.toThrow("SHA-256 mismatch");
});

it("returns bytes only after verifying the pinned digest", async () => {
  const contents = new Uint8Array([1, 2, 3]);
  const response = new Response(contents);
  await expect(
    checkedArchive(response, "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"),
  ).resolves.toEqual(Buffer.from(contents));
});
