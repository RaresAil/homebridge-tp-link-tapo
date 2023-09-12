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

    // const requestData = this.session!.cipher!.encrypt(
    //   JSON.stringify({
    //     method,
    //     params,
    //     requestTimeMils: Date.now(),
    //     terminalUUID: this.terminalUUID
    //   })
    // );

    // console.log('REQUEST DATA', requestData);

    // const response = await axios.post(
    //   `http://${this.ip}/app/request`,
    //   requestData.encrypted,
    //   {
    //     params: {
    //       seq: requestData.seq
    //     },
    //     headers: {
    //       'Content-Type': 'application/json',
    //       Cookie: this.session!.Cookie
    //     }
    //   }
    // );

    // console.log('RESPONSE', response);

    throw new Error('[KLAP] Not implemented yet');
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

      const fHandshake = await this.firstHandshake();
      await this.secondHandshake(
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

    this.session = this.session!.completeHandshake(
      new KlapCipher(localSeed, remoteSeed, authHash)
    );
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

class KlapCipher {
  private readonly key: Buffer;
  private readonly sig: Buffer;
  private readonly iv: Buffer;
  private seq: number;

  constructor(localSeed: Buffer, remoteSeed: Buffer, authHash: Buffer) {
    const { iv, seq } = this.ivDerive(localSeed, remoteSeed, authHash);
    this.key = this.keyDerive(localSeed, remoteSeed, authHash);
    this.sig = this.sigDerive(localSeed, remoteSeed, authHash);
    this.iv = iv;
    this.seq = seq;
  }

  public encrypt(msg: Buffer | string) {
    this.seq += 1;

    if (typeof msg === 'string') {
      msg = Buffer.from(msg, 'utf8');
    }

    if (!Buffer.isBuffer(msg)) {
      throw new Error('msg must be a string or buffer');
    }

    const cipher = crypto.createCipheriv('aes-256-cbc', this.key, this.ivSeq());
    const blockSize = 16;
    const paddingSize = blockSize - (msg.length % blockSize);
    const paddedMsg = Buffer.concat([
      msg,
      Buffer.alloc(paddingSize, paddingSize)
    ]);

    const ciphertext = cipher.update(paddedMsg);
    cipher.final();

    const seqBuffer = Buffer.alloc(4);
    seqBuffer.writeInt32BE(this.seq);

    const hash = crypto.createHash('sha256');
    hash.update(Buffer.concat([this.sig, seqBuffer, ciphertext]));

    const signature = hash.digest();

    return {
      encrypted: Buffer.concat([signature, ciphertext]),
      seq: this.seq
    };
  }

  public decrypt(msg: Buffer) {
    if (!Buffer.isBuffer(msg)) {
      throw new Error('msg must be a buffer');
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      this.key,
      this.ivSeq()
    );
    const decrypted = Buffer.concat([
      decipher.update(msg.subarray(32)),
      decipher.final()
    ]);

    const paddingSize = decrypted[decrypted.length - 1];
    const plaintextbytes = decrypted.subarray(
      0,
      decrypted.length - paddingSize
    );

    return plaintextbytes.toString('utf8');
  }

  private keyDerive(l: Buffer, r: Buffer, h: Buffer) {
    const payload = Buffer.concat([Buffer.from('lsk'), l, r, h]);
    const hash = crypto.createHash('sha256').update(payload).digest();
    return hash;
  }

  private ivDerive(l: Buffer, r: Buffer, h: Buffer) {
    const payload = Buffer.concat([Buffer.from('iv'), l, r, h]);
    const fullIv = crypto.createHash('sha256').update(payload).digest();
    const seq = fullIv.subarray(-4).readInt32BE(0);
    return { iv: fullIv.subarray(0, 12), seq: seq };
  }

  private sigDerive(l: Buffer, r: Buffer, h: Buffer) {
    const payload = Buffer.concat([Buffer.from('ldk'), l, r, h]);
    const hash = crypto.createHash('sha256').update(payload).digest();
    return hash.subarray(0, 28);
  }

  private ivSeq() {
    const seq = Buffer.alloc(4);
    seq.writeInt32BE(this.seq, 0);
    const iv = Buffer.concat([this.iv, seq]);

    if (iv.length !== 16) {
      throw new Error('Length of iv is not 16');
    }

    return iv;
  }
}
