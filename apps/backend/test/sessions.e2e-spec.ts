import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';

describe('Sessions REST lifecycle (e2e)', () => {
  let app: INestApplication;
  let httpUrl: string;
  let wsUrl: string;

  beforeAll(async () => {
    process.env.SQLITE_PATH = ':memory:';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.listen(0);
    const addr = app.getHttpServer().address() as { address: string; port: number };
    httpUrl = `http://127.0.0.1:${addr.port}`;
    wsUrl = httpUrl;
  });

  afterAll(async () => {
    await app.close();
  });

  let accessToken: string;
  let sessionCode: string;
  let joinToken: string;
  let signallingToken: string;

  it('dev-login issues a technician JWT', async () => {
    const res = await request(httpUrl)
      .post('/auth/dev-login')
      .send({ email: 'tech@example.com', displayName: 'Test Tech' })
      .expect(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.technician.email).toBe('tech@example.com');
    accessToken = res.body.accessToken;
  });

  it('rejects bad email', async () => {
    await request(httpUrl).post('/auth/dev-login').send({ email: 'not-an-email' }).expect(400);
  });

  it('requires auth to create a session', async () => {
    await request(httpUrl).post('/sessions').expect(401);
  });

  it('creates a session with code + join token', async () => {
    const res = await request(httpUrl)
      .post('/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    expect(res.body.session.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(res.body.joinToken).toBeTruthy();
    sessionCode = res.body.session.code;
    joinToken = res.body.joinToken;
  });

  it('endpoint joins with valid token and gets signalling token', async () => {
    const res = await request(httpUrl)
      .post(`/sessions/${sessionCode}/join`)
      .send({ joinToken, role: 'endpoint' })
      .expect(201);
    expect(res.body.session.status).toBe('active');
    expect(res.body.signallingToken).toBeTruthy();
    signallingToken = res.body.signallingToken;
  });

  it('rejects an invalid join token', async () => {
    await request(httpUrl)
      .post(`/sessions/${sessionCode}/join`)
      .send({ joinToken: 'x'.repeat(40), role: 'endpoint' })
      .expect(403);
  });

  it('rejects unknown session code', async () => {
    await request(httpUrl)
      .post('/sessions/ZZZZZZ/join')
      .send({ joinToken, role: 'endpoint' })
      .expect(404);
  });

  it('rejects invalid role', async () => {
    await request(httpUrl)
      .post(`/sessions/${sessionCode}/join`)
      .send({ joinToken, role: 'attacker' })
      .expect(400);
  });

  it('technician can join too', async () => {
    const res = await request(httpUrl)
      .post(`/sessions/${sessionCode}/join`)
      .send({ joinToken, role: 'technician' })
      .expect(201);
    expect(res.body.signallingToken).toBeTruthy();
  });

  it('ends the session and records audit events', async () => {
    const res = await request(httpUrl)
      .post(`/sessions/${sessionCode}/end`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    expect(res.body.session.status).toBe('ended');

    const get = await request(httpUrl)
      .get(`/sessions/${sessionCode}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const types = get.body.events.map((e: { eventType: string }) => e.eventType);
    expect(types).toContain('session_created');
    expect(types).toContain('endpoint_joined');
    expect(types).toContain('session_ended');
  });

  it('join after end is rejected', async () => {
    await request(httpUrl)
      .post(`/sessions/${sessionCode}/join`)
      .send({ joinToken, role: 'endpoint' })
      .expect(400);
  });

  it('ended session signalling token no longer authorizes socket join', async () => {
    const sock: Socket = io(wsUrl, { transports: ['websocket'] });
    await new Promise<void>((resolve) => sock.once('connect', () => resolve()));
    const ack = await sock.emitWithAck('signal:join', {
      sessionId: 'irrelevant',
      role: 'endpoint',
      token: signallingToken,
    });
    expect(ack.ok).toBe(false);
    sock.close();
  });
});
