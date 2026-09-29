import { describe, expect, it } from "vitest";
import { createProject } from "../src/domain/project";
import { sharedFile, sharedName, shareLink } from "../src/share";

const file = JSON.stringify({ format: "track303", version: 1, name: "Säure Tanz", project: createProject() }, null, 1);
const base = "https://musik.jodie-oesterling.de/Track303/";

describe("sharing a project as a link", () => {
  it("packs the project after #p= and unpacks it unchanged", async () => {
    const link = await shareLink(file, base);
    expect(link.startsWith(`${base}#p=`)).toBe(true);
    expect(link).toMatch(/^[^#]+#p=[A-Za-z0-9_-]+$/);
    expect(link.length, "short enough for a chat message").toBeLessThan(3_000);
    const unpacked = await sharedFile(link.slice(link.indexOf("#")));
    expect(JSON.parse(unpacked!)).toEqual(JSON.parse(file));
    expect(sharedName(unpacked!)).toBe("Säure Tanz");
  });

  it("ignores other hashes and reports a damaged link", async () => {
    expect(await sharedFile("#top")).toBeNull();
    await expect(sharedFile("#p=nichtswert")).rejects.toThrow("beschädigt");
    expect(sharedName("{")).toBe("Track");
  });
});
