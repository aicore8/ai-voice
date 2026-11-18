import { createLogger } from "@aicore8/lib/shared";
import { ResourceName } from "common";
import type { Backend } from "common/backend";
import { content } from "../content";
import { EnhancedRouter } from "./enhanced";
import { MumbleRouter } from "./mumble";
import { hasEnhancedVoice, hasVoiceRange } from "./natives";
import type { Router } from "./router";

const log = createLogger(ResourceName);

/** The panel's choice; `auto` asks the server whether it has the Enhanced voice API. */
function chooseBackend(): Backend {
  const wanted = content.settings.backend;
  const enhanced = wanted !== "mumble" && hasEnhancedVoice();
  if (wanted === "enhanced" && !enhanced)
    log.error("Enhanced voice API missing on this server, using Mumble");
  return enhanced ? "enhanced" : "mumble";
}

export const backend = chooseBackend();
const ranged = backend === "enhanced" && hasVoiceRange();
if (backend === "enhanced")
  log.info(
    ranged
      ? "Enhanced voice: range per player (SET_PLAYER_VOICE_PROXIMITY_RANGE)"
      : "Enhanced voice: no range native on this build, one channel per range",
  );
export const router: Router =
  backend === "enhanced"
    ? new EnhancedRouter(
        () => content.settings.modes.map((m) => m.distance),
        ranged,
      )
    : new MumbleRouter();
