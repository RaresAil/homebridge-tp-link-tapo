import crypto from 'crypto';
import axios from 'axios';

import TpLinkCipher from './TpLinkCipher';
import { HandshakeData } from './TPLink';
import API from './@types/API';

export default class KlapAPI extends API {
  private static readonly TP_TEST_USER = 'test@tp-link.net';
  private static readonly TP_TEST_PASSWORD = 'test';

  private handshakeData: HandshakeData = {
    expire: 0
  };

  private session?: Session;

  private tpLinkCipher?: TpLinkCipher;
  private privateKey?: string;
  private publicKey?: string;
  private classSetup = false;

  private lSeed?: Buffer;

  public async login() {
    const { body } = await this.sendSecureRequest(
      'login_device',
      {
        username: this.email,
        password: this.password
      },
      false,
      true
    );

    this.loginToken = body?.result?.token;
  }

  public async setup() {
    const keys = await TpLinkCipher.createKeyPair();
    this.publicKey = keys.public;
    this.privateKey = keys.private;
    this.classSetup = true;
  }

  public async sendRequest(
    method: string,
    params: {
      [key: string]: any;
    },
    setCookie = false
  ) {
    return axios.post(
      `http://${this.ip}/app`,
      JSON.stringify({
        method,
        params,
        requestTimeMils: Date.now()
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          ...(setCookie && this.handshakeData.cookie
            ? {
                Cookie: this.handshakeData.cookie
              }
            : {})
        }
      }
    );
  }

  public async sendSecureRequest(
    method: string,
    params: {
      [key: string]: any;
    },
    useToken = false,
    forceHandshake = false
  ) {
    if (forceHandshake) {
      await this.firstHandshake();
    } else {
      if (this.needsNewHandshake()) {
        await this.firstHandshake();
      }
    }

    const response = await axios.post(
      `http://${this.ip}/app${useToken ? `?token=${this.loginToken!}` : ''}`,
      JSON.stringify({
        method: 'securePassthrough',
        params: {
          request: this.tpLinkCipher!.encrypt(
            JSON.stringify({
              method,
              params,
              requestTimeMils: Date.now(),
              terminalUUID: this.terminalUUID
            })
          )
        }
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          Cookie: this.handshakeData.cookie!
        }
      }
    );

    let body = response?.data;
    if (body?.result?.response) {
      body = JSON.parse(this.tpLinkCipher!.decrypt(body.result.response));
    }

    return {
      response,
      body
    };
  }

  public needsNewHandshake() {
    if (!this.classSetup) {
      throw new Error('Execute the .setup() first!');
    }

    if (!this.loginToken) {
      return true;
    }

    if (!this.tpLinkCipher) {
      return true;
    }

    if (this.handshakeData.expire - Date.now() <= 40 * 1000) {
      return true;
    }

    if (!this.handshakeData.cookie) {
      return true;
    }

    return false;
  }

  private async firstHandshake(seed?: Buffer) {
    this.lSeed = seed ? seed : crypto.randomBytes(16);

    const handshake1Result = await this.sessionPost('/handshake1', this.lSeed);

    if (handshake1Result.status !== 200) {
      throw new Error('Handshake1 failed');
    }

    if (handshake1Result.headers['content-length'] !== '48') {
      throw new Error('Handshake1 failed due to invalid content length');
    }

    const cookie = handshake1Result.headers['set-cookie']?.[0];
    const data = handshake1Result.data;

    const [session, timeout] = cookie!
      .split(';')
      .map((c) => c.split('=').pop());

    this.session = new Session(timeout!, session!);

    const remoteSeed: Buffer = data.subarray(0, 16);
    const serverHash: Buffer = data.subarray(16);

    this.log.debug(
      'First handshake decoded successfully:\nRemote Seed:',
      remoteSeed.toString('hex'),
      '\nServer Hash:',
      serverHash.toString('hex'),
      '\nSession:',
      session
    );

    const localAuthHash = this.sha256(
      Buffer.concat([
        this.lSeed!,
        remoteSeed,
        this.hashAuth(this.rawEmail, this.rawPassword)
      ])
    );

    if (Buffer.compare(localAuthHash, serverHash) === 0) {
      this.log.debug('Local auth hash matches server hash');
      return {
        remoteSeed,
        authHash: localAuthHash
      };
    }

    const emptyHash = this.sha256(
      Buffer.concat([this.lSeed!, remoteSeed, this.hashAuth('', '')])
    );

    if (Buffer.compare(emptyHash, serverHash) === 0) {
      this.log.debug('Empty auth hash matches server hash');
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
      this.log.debug('Test auth hash matches server hash');
      return {
        remoteSeed,
        authHash: testHash
      };
    }

    this.session = undefined;
    throw new Error('Failed to verify server hash');
  }

  private async sessionPost(path: string, payload: Buffer) {
    return axios.post(`http://${this.ip}/app${path}`, payload, {
      responseType: 'arraybuffer',
      headers: {
        'Content-Type': 'application/octet-stream'
      }
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

  constructor(timeout: string, private sessionId?: string) {
    this.expireAt = new Date(Date.now() + parseInt(timeout) * 1000);
  }

  public get isExpired() {
    return this.expireAt.getTime() - Date.now() <= 40 * 1000;
  }

  public invalidate() {
    this.handshakeCompleted = false;
    this.sessionId = undefined;
  }
}
