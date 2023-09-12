import axios, { AxiosResponse, ResponseType } from 'axios';
import { Logger } from 'homebridge';
import AsyncLock from 'async-lock';
import crypto from 'crypto';
import http from 'http';

import API from './@types/API';

export default class KlapAPI extends API {
  private static readonly TP_TEST_USER = 'test@tp-link.net';
  private static readonly TP_TEST_PASSWORD = 'test';

  private readonly lock: AsyncLock;

  private session?: Session;

  private classSetup = false;

  private lSeed?: Buffer;

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
    this.classSetup = true;
  }

  public async sendRequest(): Promise<AxiosResponse<any, any>> {
    throw new Error('[KLAP] Legacy Method should not be called');
  }

  public async sendSecureRequest(
    method: string,
    params: {
      [key: string]: any;
    },
    useToken = false,
    forceHandshake = false
  ): Promise<{
    body: any;
    response: AxiosResponse<any, any>;
  }> {
    await this.handshake(forceHandshake);

    // const response = await axios.post(
    //   `http://${this.ip}/app${useToken ? `?token=${this.loginToken!}` : ''}`,
    //   JSON.stringify({
    //     method: 'securePassthrough',
    //     params: {
    //       request: this.tpLinkCipher!.encrypt(
    //         JSON.stringify({
    //           method,
    //           params,
    //           requestTimeMils: Date.now(),
    //           terminalUUID: this.terminalUUID
    //         })
    //       )
    //     }
    //   }),
    //   {
    //     headers: {
    //       'Content-Type': 'application/json',
    //       Cookie: this.handshakeData.cookie!
    //     }
    //   }
    // );

    // let body = response?.data;
    // if (body?.result?.response) {
    //   body = JSON.parse(this.tpLinkCipher!.decrypt(body.result.response));
    // }

    // return {
    //   response,
    //   body
    // };

    throw new Error('[KLAP] Not implemented yet');
  }

  public needsNewHandshake() {
    if (!this.classSetup) {
      throw new Error('Execute the .setup() first!');
    }

    if (!this.session) {
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

      const fHandshake = await this.firstHandshake();
      const session = await this.secondHandshake(
        this.lSeed!,
        fHandshake.remoteSeed,
        fHandshake.authHash
      );
    });
  }

  private async firstHandshake(seed?: Buffer) {
    this.lSeed = seed ? seed : crypto.randomBytes(16);

    const handshake1Result = await this.sessionPost(
      '/handshake1',
      this.lSeed,
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

    const localAuthHash = this.sha256(
      Buffer.concat([
        this.lSeed!,
        remoteSeed,
        this.hashAuth(this.rawEmail, this.rawPassword)
      ])
    );

    if (Buffer.compare(localAuthHash, serverHash) === 0) {
      this.log.debug('[KLAP] Local auth hash matches server hash');
      return {
        remoteSeed,
        authHash: localAuthHash
      };
    }

    const emptyHash = this.sha256(
      Buffer.concat([this.lSeed!, remoteSeed, this.hashAuth('', '')])
    );

    if (Buffer.compare(emptyHash, serverHash) === 0) {
      this.log.debug('[KLAP] [WARN] Empty auth hash matches server hash');
      return {
        remoteSeed,
        authHash: emptyHash
      };
    }

    const testHash = this.sha256(
      Buffer.concat([
        this.lSeed!,
        remoteSeed,
        this.hashAuth(KlapAPI.TP_TEST_USER, KlapAPI.TP_TEST_PASSWORD)
      ])
    );

    if (Buffer.compare(testHash, serverHash) === 0) {
      this.log.debug('[KLAP] [WARN] Test auth hash matches server hash');
      return {
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

      console.log('SECOND!', handshake2Result);
    } catch (e: any) {
      console.log('SECOND ERROR!', e.response);
    }
  }

  private async sessionPost(
    path: string,
    payload: Buffer,
    responseType: ResponseType,
    cookie?: string
  ) {
    return axios.post(`http://${this.ip}/app${path}`, payload, {
      responseType: responseType,
      headers: {
        Accept: 'text/plain',
        'Content-Type': 'application/octet-stream',
        ...(cookie && {
          Cookie: cookie
        })
      },
      httpAgent: new http.Agent({
        keepAlive: true
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
        this.sha1(Buffer.from(email)),
        this.sha1(Buffer.from(password))
      ])
    );
  }
}

class Session {
  private handshakeCompleted = false;
  private readonly expireAt: Date;

  constructor(timeout: string, private cookie?: string) {
    this.expireAt = new Date(Date.now() + parseInt(timeout) * 1000);
  }

  public get IsExpired() {
    return this.expireAt.getTime() - Date.now() <= 40 * 1000;
  }

  public get Cookie() {
    return this.cookie;
  }

  public invalidate() {
    this.handshakeCompleted = false;
    this.cookie = undefined;
  }
}
