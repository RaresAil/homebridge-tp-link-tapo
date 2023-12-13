import crypto from 'crypto';
import axios from 'axios';
import http from 'http';

import TpLinkCipher from './TpLinkCipher';
import { HandshakeData } from './TPLink';
import API from './@types/API';

export default class LegacyAPI extends API {
  private handshakeData: HandshakeData = {
    expire: 0
  };

  private tpLinkCipher?: TpLinkCipher;
  private privateKey?: string;
  private publicKey?: string;
  private classSetup = false;

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

    this.log.debug('[Login] BE AWARE, SENSITIVE DATA!!', JSON.stringify(body));
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
    const response = await axios.post(
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
        },
        httpAgent: new http.Agent({
          keepAlive: false
        })
      }
    );

    this.log.debug('[Send Normal Request]', JSON.stringify(response.data));
    return response;
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
      await this.handshake();
    } else {
      if (this.needsNewHandshake()) {
        await this.handshake();
      }
    }

    try {
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
          },
          httpAgent: new http.Agent({
            keepAlive: false
          })
        }
      );
  
      let body = response?.data;
      if (body?.result?.response) {
        body = JSON.parse(this.tpLinkCipher!.decrypt(body.result.response));
      }
  
      this.log.debug('[Send Secure Request]', JSON.stringify(body));
  
      return {
        response,
        body
      };
    } catch (error: any) {
      if(error.response?.status === 403 && !forceHandshake) {
        this.log.warn("Forbidden. Redoing the request with a token regeneration.");
        return this.sendSecureRequest(method, params, useToken, true);
      }
      throw new Error(`Request failed: ${error}`);
    }
  }

  public needsNewHandshake() {
    this.log.debug('[Needs Handshake] Check for Handshake');
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

  private async handshake() {
    const response = await this.sendRequest('handshake', {
      key: this.publicKey!
    });

    const key = response?.data?.result?.key;
    this.log.debug('[Handshake]', JSON.stringify(response.data));

    if (!key) {
      throw new Error('Failed to handshake with device');
    }

    const [cookie, timeout] =
      response?.headers?.['set-cookie']?.[0]?.split(';') ?? [];
    const expire = parseInt((timeout ?? '').split('=')[1] ?? '0');

    this.handshakeData.expire = Date.now() + expire * 1000;
    this.handshakeData.cookie = cookie;

    this.tpLinkCipher = this.decodeHandshakeKey(key);
  }

  private decodeHandshakeKey(key: string) {
    this.log.debug('[Decode Handshake] Decoding handshake key');
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
}
