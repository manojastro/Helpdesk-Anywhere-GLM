import { Controller, Get } from '@nestjs/common';
import type { RTCIceServer } from '@helpdesk/shared';

export interface IceConfigResponse {
  iceServers: RTCIceServer[];
  /** Info only — used by the connection-quality indicator. */
  hasTurn: boolean;
}

/**
 * Serves ICE (STUN/TURN) configuration to browser and endpoint agent.
 * TURN credentials come from env (Secret Manager in GCP), never committed.
 *
 * TURN_URL format: turn:host:port?transport=tcp  or  turns:host:443?transport=tcp
 * For TURN with dynamic credentials set TURN_USERNAME/TURN_CREDENTIAL.
 */
@Controller('config')
export class IceConfigController {
  @Get('ice')
  getIceConfig(): IceConfigResponse {
    const iceServers: RTCIceServer[] = [];
    const stun = process.env.STUN_URL ?? 'stun:stun.l.google.com:19302';
    iceServers.push({ urls: stun });

    const turnUrl = process.env.TURN_URL;
    if (turnUrl) {
      const urls = turnUrl.split(',').map((u) => u.trim()).filter(Boolean);
      const entry: RTCIceServer = { urls };
      const username = process.env.TURN_USERNAME;
      const credential = process.env.TURN_CREDENTIAL;
      if (username && credential) {
        entry.username = username;
        entry.credential = credential;
      }
      iceServers.push(entry);
    }

    return { iceServers, hasTurn: Boolean(turnUrl) };
  }
}
