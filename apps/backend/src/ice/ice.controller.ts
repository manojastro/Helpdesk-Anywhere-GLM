import { Controller, Get, Logger } from '@nestjs/common';
import type { RTCIceServer } from '@helpdesk/shared';

export interface IceConfigResponse {
  iceServers: RTCIceServer[];
  /** Info only — used by the connection-quality indicator. */
  hasTurn: boolean;
}

/** Schemes RTCPeerConnection accepts; anything else makes the constructor throw. */
const ICE_SCHEMES = ['turn:', 'turns:', 'stun:', 'stuns:'];

function isValidIceUrl(url: string): boolean {
  return ICE_SCHEMES.some((scheme) => url.startsWith(scheme));
}

/**
 * Serves ICE (STUN/TURN) configuration to browser and endpoint agent.
 * TURN credentials come from env (Secret Manager in GCP), never committed.
 *
 * TURN_URL format: turn:host:port?transport=tcp  or  turns:host:443?transport=tcp
 * Multiple URLs are comma-separated.
 * For TURN with dynamic credentials set TURN_USERNAME/TURN_CREDENTIAL.
 */
@Controller('config')
export class IceConfigController {
  private readonly logger = new Logger('IceConfig');

  @Get('ice')
  getIceConfig(): IceConfigResponse {
    const iceServers: RTCIceServer[] = [];
    const stun = process.env.STUN_URL ?? 'stun:stun.l.google.com:19302';
    if (isValidIceUrl(stun)) {
      iceServers.push({ urls: stun });
    } else {
      this.logger.warn(`ignoring STUN_URL with unsupported scheme: ${stun}`);
    }

    const turnUrl = process.env.TURN_URL;
    let hasTurn = false;
    if (turnUrl) {
      const urls = turnUrl
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean)
        .filter((u) => {
          // A malformed URL makes the browser's RTCPeerConnection constructor
          // throw, which kills the whole session — drop it instead of serving it.
          if (isValidIceUrl(u)) return true;
          this.logger.warn(`ignoring TURN_URL entry with unsupported scheme: ${u}`);
          return false;
        });
      if (urls.length > 0) {
        const entry: RTCIceServer = { urls };
        const username = process.env.TURN_USERNAME;
        const credential = process.env.TURN_CREDENTIAL;
        if (username && credential) {
          entry.username = username;
          entry.credential = credential;
        }
        iceServers.push(entry);
        hasTurn = true;
      } else {
        this.logger.warn('TURN_URL was set but no entry had a usable scheme');
      }
    }

    return { iceServers, hasTurn };
  }
}
