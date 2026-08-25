import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { IceConfigModule } from '../src/ice/ice.module';

/**
 * A malformed TURN_URL used to reach the browser verbatim, where
 * `new RTCPeerConnection(config)` throws
 * "SyntaxError: Failed to construct 'RTCPeerConnection': 'turn' is not a valid URL."
 * and no session can be opened at all. The controller now drops entries whose
 * scheme the browser will not accept.
 */
describe('ICE config (e2e)', () => {
  let app: INestApplication;
  let httpUrl: string;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [IceConfigModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    const addr = app.getHttpServer().address() as { address: string; port: number };
    httpUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    delete process.env.TURN_URL;
    delete process.env.TURN_USERNAME;
    delete process.env.TURN_CREDENTIAL;
    delete process.env.STUN_URL;
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  it('serves the default STUN server when no TURN is configured', async () => {
    const res = await request(httpUrl).get('/config/ice').expect(200);
    expect(res.body.iceServers).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
    expect(res.body.hasTurn).toBe(false);
  });

  it('accepts a well-formed TURN_URL and keeps both entries', async () => {
    process.env.TURN_URL =
      'turn:34.1.2.3:3478?transport=tcp,turns:34.1.2.3:443?transport=tcp';
    process.env.TURN_USERNAME = 'helpdesk';
    process.env.TURN_CREDENTIAL = 'secret';

    const res = await request(httpUrl).get('/config/ice').expect(200);
    expect(res.body.hasTurn).toBe(true);
    expect(res.body.iceServers[1]).toEqual({
      urls: ['turn:34.1.2.3:3478?transport=tcp', 'turns:34.1.2.3:443?transport=tcp'],
      username: 'helpdesk',
      credential: 'secret',
    });
  });

  it('drops a malformed TURN_URL instead of serving it to the browser', async () => {
    // The value the old Terraform template rendered: commas for scheme colons,
    // semicolon for the separator.
    process.env.TURN_URL =
      'turn,34.1.2.3:3478?transport=tcp;turns,34.1.2.3:443?transport=tcp';
    process.env.TURN_USERNAME = 'helpdesk';
    process.env.TURN_CREDENTIAL = 'secret';

    const res = await request(httpUrl).get('/config/ice').expect(200);
    expect(res.body.hasTurn).toBe(false);
    expect(res.body.iceServers).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
  });

  it('keeps the usable entries when only some are malformed', async () => {
    process.env.TURN_URL = 'turn,broken:3478,turns:34.1.2.3:443?transport=tcp';

    const res = await request(httpUrl).get('/config/ice').expect(200);
    expect(res.body.hasTurn).toBe(true);
    expect(res.body.iceServers[1].urls).toEqual(['turns:34.1.2.3:443?transport=tcp']);
  });

  it('ignores a STUN_URL with an unsupported scheme', async () => {
    process.env.STUN_URL = 'http://not-a-stun-server:3478';

    const res = await request(httpUrl).get('/config/ice').expect(200);
    expect(res.body.iceServers).toEqual([]);
    expect(res.body.hasTurn).toBe(false);
  });
});
