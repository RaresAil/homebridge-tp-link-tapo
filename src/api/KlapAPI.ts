import axios, { AxiosResponse, ResponseType } from 'axios';
import { Logger } from 'homebridge';
import AsyncLock from 'async-lock';
import crypto from 'crypto';
import http from 'http';

import KlapCipher from './KlapCipher';
import API from './@types/API';

export default class KlapAPI extends API {
  private static readonly TP_TEST_USER = 'test@tp-link.net';
  private static readonly TP_TEST_PASSWORD = 'test';

  private readonly lock: AsyncLock;

  private session?: Session;

  constructor(
    protected readonly ip: string,
    protected readonly email: string,
    protected readonly password: string,
    protected readonly log: Logger
  ) {
    super(ip, email, password, log);
    this.lock = new AsyncLock();
  }

  public async login() {
    this.log.debug('[KLAP] Legacy login that does nothing, ignore this');
  }

  public async setup() {
    this.log.debug('[KLAP] Legacy setup that does nothing, ignore this');
  }

  public async sendRequest(): Promise<AxiosResponse<any, any>> {
    throw new Error('[KLAP] Legacy Method should not be called');
  }

  public async sendSecureRequest(
    method: string,
    params: {
      [key: string]: any;
    },
    _: boolean,
    forceHandshake = false
  ): Promise<{
    body: any;
    response: AxiosResponse<any, any>;
  }> {
    await this.handshake(forceHandshake);

    const rawRequest = JSON.stringify({
      method,
      params: (Object.keys(params).length > 0 && params) || null
    });
    this.log.debug('[KLAP] Sending request:', rawRequest);

    const requestData = this.session!.cipher!.encrypt(rawRequest);

    try {
      const response = await this.sessionPost(
        '/request',
        requestData.encrypted,
        'arraybuffer',
        this.session!.Cookie,
        {
          seq: requestData.seq.toString()
        }
      );
  
      if (response.status !== 200) {
        throw new Error('[KLAP] Request failed');
      }
  
      const data = JSON.parse(this.session!.cipher!.decrypt(response.data));
  
      return {
        response,
        body: data
      };
    } catch(error:any) {
      if(error.response?.status === 403 && !forceHandshake) {
        this.log.warn("[KLAP] Forbidden. Redoing the request with a token regeneration.");
        return this.sendSecureRequest(method, params, _, true);
      }
      throw new Error(`[KLAP] Request failed: ${error}`);
    }
  }

  public needsNewHandshake() {
    if (!this.session) {
      return true;
    }

    if (!this.session.cipher) {
      return true;
    }

    if (this.session.IsExpired) {
      return true;
    }

    if (!this.session.Cookie) {
      return true;
    }

    return false;
  }

  private async handshake(force = false) {
    return this.lock.acquire('handshake', async () => {
      if (!this.needsNewHandshake() && !force) {
        return;
      }

      const { localSeed, remoteSeed, authHash } = await this.firstHandshake();
      await this.secondHandshake(localSeed, remoteSeed, authHash);
    });
  }

  private async firstHandshake(seed?: Buffer) {
    const localSeed = seed ? seed : crypto.randomBytes(16);

    const handshake1Result = await this.sessionPost(
      '/handshake1',
      localSeed,
      'arraybuffer'
    );

    if (handshake1Result.status !== 200) {
      throw new Error('Handshake1 failed');
    }

    if (handshake1Result.headers['content-length'] !== '48') {
      throw new Error('Handshake1 failed due to invalid content length');
    }

    const cookie = handshake1Result.headers['set-cookie']?.[0];
    const data = handshake1Result.data;

    const [cookieValue, timeout] = cookie!.split(';');
    const timeoutValue = timeout.split('=').pop();

    this.session = new Session(timeoutValue!, cookieValue!);

    const remoteSeed: Buffer = data.subarray(0, 16);
    const serverHash: Buffer = data.subarray(16);

    this.log.debug(
      '[KLAP] First handshake decoded successfully:\nRemote Seed:',
      remoteSeed.toString('hex'),
      '\nServer Hash:',
      serverHash.toString('hex'),
      '\nCookie:',
      cookieValue
    );

    const localHash = this.hashAuth(this.rawEmail, this.rawPassword);
    const localAuthHash = this.sha256(
      Buffer.concat([localSeed, remoteSeed, localHash])
    );

    if (Buffer.compare(localAuthHash, serverHash) === 0) {
      this.log.debug('[KLAP] Local auth hash matches server hash');
      return {
        localSeed,
        remoteSeed,
        authHash: localHash
      };
    }

    const emptyHash = this.sha256(
      Buffer.concat([localSeed, remoteSeed, this.hashAuth('', '')])
    );

    if (Buffer.compare(emptyHash, serverHash) === 0) {
      this.log.debug('[KLAP] [WARN] Empty auth hash matches server hash');
      return {
        localSeed,
        remoteSeed,
        authHash: emptyHash
      };
    }

    const testHash = this.sha256(
      Buffer.concat([
        localSeed,
        remoteSeed,
        this.hashAuth(KlapAPI.TP_TEST_USER, KlapAPI.TP_TEST_PASSWORD)
      ])
    );

    if (Buffer.compare(testHash, serverHash) === 0) {
      this.log.debug('[KLAP] [WARN] Test auth hash matches server hash');
      return {
        localSeed,
        remoteSeed,
        authHash: testHash
      };
    }

    this.session = undefined;
    throw new Error('Failed to verify server hash');
  }

  private async secondHandshake(
    localSeed: Buffer,
    remoteSeed: Buffer,
    authHash: Buffer
  ) {
    const localAuthHash = this.sha256(
      Buffer.concat([remoteSeed, localSeed, authHash])
    );

    try {
      const handshake2Result = await this.sessionPost(
        '/handshake2',
        localAuthHash,
        'text',
        this.session!.Cookie
      );

      if (handshake2Result.status === 200) {
        this.log.debug('[KLAP] Second handshake successful');
        this.session = this.session!.completeHandshake(
          new KlapCipher(localSeed, remoteSeed, authHash)
        );

        return;
      }

      this.log.warn('[KLAP] Second handshake failed', handshake2Result.data);
    } catch (e: any) {
      this.log.error(
        '[KLAP] Second handshake failed:',
        e.response.data || e.message
      );
    }

    this.session = undefined;
  }

  private async sessionPost(
    path: string,
    payload: Buffer,
    responseType: ResponseType,
    cookie?: string,
    params?: Record<string, unknown>
  ) {
    return axios.post(`http://${this.ip}/app${path}`, payload, {
      responseType: responseType,
      params: params,
      headers: {
        Host: this.ip,
        Accept: '*/*',
        'Content-Type': 'application/octet-stream',
        ...(cookie && {
          Cookie: cookie
        })
      },
      httpAgent: new http.Agent({
        keepAlive: false
      })
    });
  }

  private sha256(data: Buffer) {
    return crypto.createHash('sha256').update(data).digest();
  }

  private sha1(data: Buffer) {
    return crypto.createHash('sha1').update(data).digest();
  }

  private hashAuth(email: string, password: string) {
    return this.sha256(
      Buffer.concat([
        this.sha1(Buffer.from(email.normalize('NFKC'))),
        this.sha1(Buffer.from(password.normalize('NFKC')))
      ])
    );
  }
}

class Session {
  public readonly handshakeCompleted: boolean = false;

  private readonly expireAt: Date;
  private readonly rawTimeout: string;

  constructor(
    timeout: string,
    private readonly cookie: string,
    public readonly cipher?: KlapCipher
  ) {
    this.rawTimeout = timeout;
    this.expireAt = new Date(Date.now() + parseInt(timeout) * 1000);

    if (cipher) {
      this.handshakeCompleted = true;
    }
  }

  public get IsExpired() {
    return this.expireAt.getTime() - Date.now() <= 40 * 1000;
  }

  public get Cookie() {
    return this.cookie;
  }

  public completeHandshake(cipher: KlapCipher) {
    return new Session(this.rawTimeout, this.cookie, cipher);
  }
}
