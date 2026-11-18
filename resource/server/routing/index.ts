import { GlobalKey, onStop } from "@aicore8/lib/server";
import { createLogger } from "@aicore8/lib/shared";
import { ResourceName } from "common";
import { parseBackend } from "common/backend";
import { KEYS } from "common/voice";
import { content } from "../content";
import { backend, router } from "./backend";

const log = createLogger(ResourceName);

new GlobalKey(KEYS.backend, parseBackend).set(backend);
content.showStatus({ backendActive: backend });
log.info(`voice backend: ${backend}`);

onStop(() => router.stop());
