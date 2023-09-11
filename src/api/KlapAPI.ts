import crypto from 'crypto';
import axios from 'axios';

import TpLinkCipher from './TpLinkCipher';
import { HandshakeData } from './TPLink';
import API from './@types/API';

export default class KlapAPI extends API {
  private handshakeData: HandshakeData = {
    expire: 0
  };

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
    // const response = await this.sendRequest('handshake', {
    //   key: this.publicKey!
    // });

    // console.log(
    //   await this.sessionPost('/handshake1', this.lSeed.toString('base64'))
    // );

    // const key = response?.data?.result?.key;
    // const [cookie, timeout] =
    //   response?.headers?.['set-cookie']?.[0]?.split(';') ?? [];
    // const expire = parseInt((timeout ?? '').split('=')[1] ?? '0');

    // this.handshakeData.expire = Date.now() + expire * 1000;
    // this.handshakeData.cookie = cookie;

    // this.tpLinkCipher = this.decodeHandshakeKey(key);
  }

  private decodeHandshakeKey(key: string) {
    if (!this.classSetup) {
      throw new Error('Execute the .setup() first!');
    }

    const decodedKey = Buffer.from(key, 'base64');
    const decrypted = crypto.privateDecrypt(
      {
        key: this.privateKey!,
        padding: crypto.constants.RSA_PKCS1_PADDING
      },
      decodedKey
    );

    const keyLen = 16;

    return new TpLinkCipher(
      decrypted.subarray(0, keyLen),
      decrypted.subarray(keyLen, keyLen * 2)
    );
  }

  private async sessionPost(path: string, payload: string) {
    return axios.post(`http://${this.ip}/app${path}`, payload, {
      headers: {
        // 'Content-Type': 'application/json',
        // Cookie: cookie
      }
    });
  }
}

// class Session {}
