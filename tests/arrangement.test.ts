import { describe, expect, it } from "vitest";
import { nextPosition, startPosition, type Arrangement } from "../src/sound/arrangement";

const loop: Arrangement = { mode: "loop", song: [0, 1, 1, 3], songStart: 0 };
const song: Arrangement = { ...loop, mode: "song" };

describe("arrangement", () => {
  it("loops the shown pattern and takes a queued one at its end", () => {
    expect(startPosition(loop, 5)).toEqual({ pattern: 5, songIndex: null });
    expect(nextPosition({ pattern: 5, songIndex: null }, loop, null)).toEqual({ pattern: 5, songIndex: null });
    expect(nextPosition({ pattern: 5, songIndex: null }, loop, 2)).toEqual({ pattern: 2, songIndex: null });
  });

  it("follows the song list and repeats it from the top", () => {
    let position = startPosition(song, 5);
    const played = [position.pattern];
    for (let step = 0; step < 5; step += 1) {
      position = nextPosition(position, song, 7);
      played.push(position.pattern);
    }
    expect(played).toEqual([0, 1, 1, 3, 0, 1]);
  });

  it("starts from a chosen entry, clamped to the song", () => {
    expect(startPosition({ ...song, songStart: 2 }, 0)).toEqual({ pattern: 1, songIndex: 2 });
    expect(startPosition({ ...song, songStart: 99 }, 0)).toEqual({ pattern: 3, songIndex: 3 });
  });

  it("switching to song while a loop plays starts the song at the next pattern end", () => {
    expect(nextPosition({ pattern: 6, songIndex: null }, { ...song, songStart: 1 }, null)).toEqual({ pattern: 1, songIndex: 1 });
  });

  it("keeps going when the song got shorter under the playhead", () => {
    expect(nextPosition({ pattern: 3, songIndex: 3 }, { ...song, song: [4, 5] }, null)).toEqual({ pattern: 4, songIndex: 0 });
  });
});
