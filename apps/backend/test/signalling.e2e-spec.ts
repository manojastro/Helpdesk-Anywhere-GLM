import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';

describe('Signalling gateway (e2e)', () => {
  let app: INestApplication;
  let httpUrl: string;

  let sessionCode: string;
  let joinToken: string;
  let techSock: Socket;
  let endpointSock: Socket;
  let techToken: string;
  let endpointToken: string;
  let sessionId: string;

  beforeAll(async () => {
    process.env.SQLITE_PATH = ':memory:';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.listen(0);
    const addr = app.getHttpServer().address() as { port: number };
    httpUrl = `http://127.0.0.1:${addr.port}`;

    const login = await request(httpUrl).post('/auth/dev-login').send({ email: 'sig@example.com' });
    const created = await request(httpUrl)
      .post('/sessions')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    sessionCode = created.body.session.code as string;
    sessionId = created.body.session.id as string;
    joinToken = created.body.joinToken as string;

    const t = await request(httpUrl)
      .post(`/sessions/${sessionCode}/join`)
      .send({ joinToken, role: 'technician' });
    techToken = t.body.signallingToken as string;
    const e = await request(httpUrl)
      .post(`/sessions/${sessionCode}/join`)
      .send({ joinToken, role: 'endpoint' });
    endpointToken = e.body.signallingToken as string;
  });

  afterAll(async () => {
    techSock?.close();
    endpointSock?.close();
    await app.close();
  });

  function connect(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const sock = io(httpUrl, { transports: ['websocket'] });
      sock.once('connect', () => resolve(sock));
      sock.once('connect_error', reject);
    });
  }

  function expectEvent<T>(sock: Socket, event: string): Promise<T> {
    return new Promise((resolve) => sock.once(event, (payload: T) => resolve(payload)));
  }

  it('rejects join with invalid token', async () => {
    const sock = await connect();
    const res = await sock.emitWithAck('signal:join', {
      sessionId,
      role: 'endpoint',
      token: 'garbage',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('invalid');
    sock.close();
  });

  it('rejects role mismatch', async () => {
    const sock = await connect();
    const res = await sock.emitWithAck('signal:join', {
      sessionId,
      role: 'technician',
      token: endpointToken,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('mismatch');
    sock.close();
  });

  it('technician joins, then endpoint joins and both see peer-joined', async () => {
    techSock = await connect();
    const ackT = await techSock.emitWithAck('signal:join', {
      sessionId,
      role: 'technician',
      token: techToken,
    });
    expect(ackT.ok).toBe(true);
    expect(ackT.peers).toHaveLength(0);

    const peerJoinedP = expectEvent<{ peer: string }>(techSock, 'signal:peer-joined');
    endpointSock = await connect();
    const ackE = await endpointSock.emitWithAck('signal:join', {
      sessionId,
      role: 'endpoint',
      token: endpointToken,
    });
    expect(ackE.ok).toBe(true);
    expect(ackE.peers).toHaveLength(1);

    const evt = await peerJoinedP;
    expect(evt.peer.startsWith('endpoint:')).toBe(true);
  });

  it('rejects a second socket claiming an occupied role', async () => {
    const sock = await connect();
    const res = await sock.emitWithAck('signal:join', {
      sessionId,
      role: 'endpoint',
      token: endpointToken,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('already connected');
    sock.close();
  });

  it('relays SDP offer from technician to endpoint', async () => {
    const sdpP = expectEvent<{ from: string; sdp: { type: string; sdp: string } }>(
      endpointSock,
      'signal:sdp',
    );
    await techSock.emitWithAck('signal:sdp', {
      sessionId,
      sdp: { type: 'offer', sdp: 'v=0 fake-offer-sdp' },
    });
    const evt = await sdpP;
    expect(evt.from.startsWith('technician:')).toBe(true);
    expect(evt.sdp.type).toBe('offer');
    expect(evt.sdp.sdp).toBe('v=0 fake-offer-sdp');
  });

  it('relays SDP answer back', async () => {
    const sdpP = expectEvent<{ from: string; sdp: { type: string } }>(techSock, 'signal:sdp');
    await endpointSock.emitWithAck('signal:sdp', {
      sessionId,
      sdp: { type: 'answer', sdp: 'v=0 fake-answer-sdp' },
    });
    const evt = await sdpP;
    expect(evt.from.startsWith('endpoint:')).toBe(true);
    expect(evt.sdp.type).toBe('answer');
  });

  it('relays ICE candidates both directions', async () => {
    const onEndpoint = expectEvent<{ from: string; candidate: { candidate: string } }>(
      endpointSock,
      'signal:ice',
    );
    await techSock.emitWithAck('signal:ice', {
      sessionId,
      candidate: { candidate: 'candidate:1 tech', sdpMid: '0', sdpMLineIndex: 0 },
    });
    const evt1 = await onEndpoint;
    expect(evt1.candidate.candidate).toBe('candidate:1 tech');

    const onTech = expectEvent<{ candidate: { candidate: string } }>(techSock, 'signal:ice');
    await endpointSock.emitWithAck('signal:ice', {
      sessionId,
      candidate: { candidate: 'candidate:2 endpoint', sdpMid: '0', sdpMLineIndex: 0 },
    });
    const evt2 = await onTech;
    expect(evt2.candidate.candidate).toBe('candidate:2 endpoint');
  });

  it('rejects relay from a socket that did not join the session', async () => {
    const sock = await connect();
    const res = await sock.emitWithAck('signal:sdp', {
      sessionId,
      sdp: { type: 'offer', sdp: 'x' },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('not a member');
    sock.close();
  });

  it('emits peer-left when a peer disconnects', async () => {
    const leftP = expectEvent<{ peer: string }>(techSock, 'signal:peer-left');
    endpointSock.close();
    const evt = await leftP;
    expect(evt.peer.startsWith('endpoint:')).toBe(true);
  });
});
