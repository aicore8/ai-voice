import { every, type Job } from "@aifivem/lib/server";
import { RANGE_MAX } from "common/proximity";
import { Bucket } from "./bucket";
import type { VoiceChannel } from "./channel";
import { flatChannel, leaveFlatChannel } from "./flatChannels";
import { PlayerRanges } from "./range";
import type { Router, Talker } from "./router";

/**
 * FiveM for GTAV Enhanced: the server routes all audio. Proximity per routing bucket: with
 * `SET_PLAYER_VOICE_PROXIMITY_RANGE` (build 177+, `ranged`) one spatial channel of `RANGE_MAX` and each player's range
 * on the player (a change is one native); on older builds one channel per range, every player in all of them and
 * unmuted only in their own. Radio: a 2D channel per frequency, muted until push-to-talk; calls: a 2D channel each.
 * FiveM has no routing bucket event, so a 1 s job moves players whose bucket changed (and rewrites ranged ranges).
 */
export class EnhancedRouter implements Router {
  readonly backend = "enhanced";
  private readonly buckets = new Map<number, Bucket>();
  /** The bucket each player's proximity channels belong to. */
  private readonly bucketOf = new Map<number, number>();
  private readonly radios = new Map<number, VoiceChannel>();
  private readonly calls = new Map<number, VoiceChannel>();
  private readonly timer: Job;
  /** Set only in ranged mode. */
  private readonly ranges: PlayerRanges | null;

  /** `modeDistances`: the panel's ranges, whose channels stay while empty; `ranged`: the range native exists. */
  constructor(
    private readonly modeDistances: () => readonly number[],
    private readonly ranged: boolean,
  ) {
    this.ranges = ranged ? new PlayerRanges() : null;
    this.timer = every(1000, () => this.watchBuckets(), {
      name: "voiceBuckets",
    });
  }

  join(talker: Talker): void {
    const bucketId = GetPlayerRoutingBucket(String(talker.source));
    this.bucketOf.set(talker.source, bucketId);
    const bucket = this.bucket(bucketId);
    bucket.talkers.set(talker.source, talker);
    // The range first: unmuted in a 100 m channel, the player must never be heard at that distance.
    this.ranges?.set(talker);
    const own = this.channelOf(talker);
    bucket.channel(own);
    for (const [distance, channel] of bucket.channels)
      channel.add(talker.source, talker.muted || distance !== own);
  }

  forget(source: number): void {
    const bucketId = this.bucketOf.get(source);
    this.bucketOf.delete(source);
    for (const channel of this.radios.values()) channel.forget(source);
    for (const channel of this.calls.values()) channel.forget(source);
    if (bucketId === undefined) return;
    const bucket = this.buckets.get(bucketId);
    if (!bucket) return;
    bucket.talkers.delete(source);
    for (const channel of bucket.channels.values()) channel.forget(source);
    this.prune(bucketId, bucket);
  }

  update(talker: Talker): void {
    const bucketId = this.bucketOf.get(talker.source);
    const bucket = bucketId === undefined ? null : this.buckets.get(bucketId);
    if (bucketId === undefined || !bucket) return this.join(talker);
    bucket.talkers.set(talker.source, talker);
    const own = this.channelOf(talker);
    bucket.channel(own);
    for (const [distance, channel] of bucket.channels)
      channel.setMuted(talker.source, talker.muted || distance !== own);
    this.ranges?.set(talker);
    for (const channel of this.calls.values())
      channel.setMuted(talker.source, talker.muted);
    if (talker.muted)
      for (const channel of this.radios.values())
        channel.setMuted(talker.source, true);
    this.prune(bucketId, bucket);
  }

  radioJoin(source: number, channel: number): void {
    flatChannel(this.radios, channel, "radio")?.add(source, true);
  }

  radioLeave(source: number, channel: number): void {
    leaveFlatChannel(this.radios, channel, source);
  }

  radioTalk(source: number, channel: number, talking: boolean): void {
    const muted = this.bucketTalker(source)?.muted ?? false;
    this.radios.get(channel)?.setMuted(source, muted || !talking);
  }

  callJoin(source: number, channel: number): void {
    const muted = this.bucketTalker(source)?.muted ?? false;
    flatChannel(this.calls, channel, "call")?.add(source, muted);
  }

  callLeave(source: number, channel: number): void {
    leaveFlatChannel(this.calls, channel, source);
  }

  callBystander(
    source: number,
    channel: number,
    on: boolean,
    talks: boolean,
  ): void {
    const call = this.calls.get(channel);
    if (!call) return;
    if (!on) return call.remove(source);
    const muted = this.bucketTalker(source)?.muted ?? false;
    call.add(source, muted || !talks);
  }

  rebuild(talkers: Iterable<Talker>): void {
    for (const bucket of this.buckets.values())
      for (const channel of bucket.channels.values()) channel.destroy();
    this.buckets.clear();
    this.bucketOf.clear();
    for (const talker of talkers) this.join(talker);
  }

  stop(): void {
    this.timer.stop();
    // The range stays on the player otherwise: another voice script would start with it.
    this.ranges?.reset(this.bucketOf.keys());
    for (const bucket of this.buckets.values())
      for (const channel of bucket.channels.values()) channel.destroy();
    for (const channel of this.radios.values()) channel.destroy();
    for (const channel of this.calls.values()) channel.destroy();
    this.buckets.clear();
    this.radios.clear();
    this.calls.clear();
  }

  describe(): string[] {
    const lines = [
      this.ranged
        ? "proximity: range per player, one channel per bucket"
        : "proximity: one channel per range",
    ];
    for (const [id, bucket] of this.buckets)
      for (const channel of bucket.channels.values())
        lines.push(`bucket ${id}: ${channel.describe()}`);
    for (const channel of this.radios.values()) lines.push(channel.describe());
    for (const channel of this.calls.values()) lines.push(channel.describe());
    return lines;
  }

  private bucket(id: number): Bucket {
    let bucket = this.buckets.get(id);
    if (!bucket)
      this.buckets.set(id, (bucket = new Bucket((t) => this.channelOf(t))));
    return bucket;
  }

  private bucketTalker(source: number): Talker | undefined {
    const id = this.bucketOf.get(source);
    return id === undefined
      ? undefined
      : this.buckets.get(id)?.talkers.get(source);
  }

  /** The spatial channel a talker is heard in: the shared one, or the one of their range. */
  private channelOf(talker: Talker): number {
    return this.ranged ? RANGE_MAX : talker.distance;
  }

  /** Drops channels of custom ranges nobody talks at, and empty buckets. */
  private prune(id: number, bucket: Bucket): void {
    if (bucket.talkers.size === 0) {
      for (const channel of bucket.channels.values()) channel.destroy();
      this.buckets.delete(id);
      return;
    }
    bucket.pruneChannels(this.ranged ? [RANGE_MAX] : this.modeDistances());
  }

  private watchBuckets(): void {
    for (const [source, id] of this.bucketOf) {
      const now = GetPlayerRoutingBucket(String(source));
      if (now === id) {
        // The deprecated client native MUMBLE_SET_TALKER_PROXIMITY writes the same range: written again each second,
        // a client that changes its own is back at the server's range within 1 s.
        const talker = this.ranges ? this.bucketTalker(source) : undefined;
        if (talker) this.ranges?.set(talker);
        continue;
      }
      const talker = this.bucketTalker(source);
      const old = this.buckets.get(id);
      if (old && talker) {
        old.talkers.delete(source);
        for (const channel of old.channels.values()) channel.remove(source);
        this.prune(id, old);
      }
      if (talker) this.join(talker);
    }
  }
}
