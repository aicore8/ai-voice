import { createLogger } from "@aifivem/lib/shared";
import { ResourceName } from "common";
import { voiceNatives } from "./natives";
import type { Talker } from "./router";

const log = createLogger(ResourceName);

/** Ranged mode's per-player range (`SET_PLAYER_VOICE_PROXIMITY_RANGE`); a refused one is logged once. */
export class PlayerRanges {
  private failed = false;

  set(talker: Talker): void {
    if (voiceNatives.range(talker.source, talker.distance)) return;
    if (!this.failed) log.error(`voice range for ${talker.source} was refused`);
    this.failed = true;
  }

  /** Back to the channel's distance (0), so another voice script does not start with ours. */
  reset(sources: Iterable<number>): void {
    for (const source of sources) voiceNatives.range(source, 0);
  }
}
