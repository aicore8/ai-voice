import { createLogger } from "@aifivem/lib/shared";
import { ResourceName } from "common";
import { VoiceChannel } from "./channel";
import type { Talker } from "./router";

const log = createLogger(ResourceName);

/**
 * One routing bucket's proximity and who is in it. Its spatial channels are keyed by their maxDistance; `channelOf`
 * says which one a talker is heard in (their own range, or the one shared channel when the range is set per player).
 */
export class Bucket {
  readonly channels = new Map<number, VoiceChannel>();
  readonly talkers = new Map<number, Talker>();

  constructor(private readonly channelOf: (talker: Talker) => number) {}

  /** The bucket's channel of a distance; a new one takes every player of the bucket in, muted outside it. */
  channel(distance: number): void {
    if (this.channels.has(distance)) return;
    const channel = VoiceChannel.spatial(distance, `proximity ${distance}m`);
    if (!channel) return log.error("voice channel limit reached");
    this.channels.set(distance, channel);
    for (const talker of this.talkers.values())
      channel.add(
        talker.source,
        talker.muted || this.channelOf(talker) !== distance,
      );
  }

  /** Drops channels nobody is heard in (`keepDistances`: kept while empty). */
  pruneChannels(keepDistances: readonly number[]): void {
    const keep = new Set(keepDistances);
    for (const talker of this.talkers.values())
      keep.add(this.channelOf(talker));
    for (const [distance, channel] of this.channels) {
      if (keep.has(distance)) continue;
      channel.destroy();
      this.channels.delete(distance);
    }
  }
}
