import { logger } from "../Logger";

type CachedTurn = {
    iceServers: RTCIceServer[];
    expiresAt: number;
};

let cache: CachedTurn | null = null;
let inflight: Promise<RTCIceServer[] | null> | null = null;

const CACHE_SKEW_MS = 60_000;

export async function getCloudflareTurnCredentials(): Promise<
    RTCIceServer[] | null
> {
    const now = Date.now();
    if (cache && cache.expiresAt > now + CACHE_SKEW_MS) {
        return cache.iceServers;
    }

    if (inflight) return inflight;

    inflight = fetchCloudflareTurnCredentials()
        .then((iceServers) => {
            if (iceServers) {
                const ttlSec = process.env.CF_TURN_TTL
                    ? parseInt(process.env.CF_TURN_TTL, 10)
                    : 86400;
                const ttlMs = Number.isFinite(ttlSec)
                    ? Math.max(60, ttlSec) * 1000
                    : 86_400_000;
                cache = {
                    iceServers,
                    expiresAt: Date.now() + ttlMs,
                };
            }
            return iceServers;
        })
        .finally(() => {
            inflight = null;
        });

    return inflight;
}

async function fetchCloudflareTurnCredentials(): Promise<
    RTCIceServer[] | null
> {
    const keyId = process.env.CF_TURN_KEY_ID;
    const apiToken = process.env.CF_API_TOKEN;
    const ttl = process.env.CF_TURN_TTL
        ? parseInt(process.env.CF_TURN_TTL)
        : 86400;

    if (!keyId || !apiToken) return null;

    const res = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ ttl }),
        },
    );

    if (!res.ok) return null;

    const json = await res.json().catch(() => ({}) as any);
    const r = json.result ?? json;

    if (!Array.isArray(r.iceServers)) {
        logger.warn("Cloudflare TURN response missing iceServers:", r);
        return null;
    }

    return r.iceServers;
}
