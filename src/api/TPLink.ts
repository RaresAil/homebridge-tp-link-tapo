import AsyncLock from 'async-lock';
import fetch from 'node-fetch';
import crypto from 'crypto';
import { URL } from 'url';
import { v4 } from 'uuid';

import DeviceInfo from './@types/DeviceInfo';
import TpLinkCipher from './TpLinkCipher';
import commands from './commands';
import { Logger } from 'homebridge';

export interface HandshakeData {
  cookie?: string;
  expire: number;
}

type Commands = typeof commands;
type Command = keyof Commands;
type CommandReturnType<T extends Command> = ReturnType<Commands[T]>;

export default class TPLink {
  private readonly terminalUUID: string;
  private readonly lock: AsyncLock;

  private handshakeData: HandshakeData = {
    expire: 0
  };

  private tpLinkCipher?: TpLinkCipher;
  private privateKey?: string;
  private publicKey?: string;
  private classSetup = false;

  private loginToken?: string;
  private tryResendCommand = false;

  private infoCache?: {
    data: DeviceInfo;
    setAt: number;
  };

  constructor(
    private readonly ip: string,
    private readonly email: string,
    private readonly password: string,
    private readonly log: Logger
  ) {
    this.email = TpLinkCipher.toBase64(TpLinkCipher.encodeUsername(this.email));
    this.password = TpLinkCipher.toBase64(this.password);
    this.terminalUUID = v4();
    this.lock = new AsyncLock();
  }

  public async setup(): Promise<TPLink> {
    if (this.classSetup) {
      return this;
    }

    const keys = await TpLinkCipher.createKeyPair();
    this.publicKey = keys.public;
    this.privateKey = keys.private;
    this.classSetup = true;
    return this;
  }

  public async getInfo(): Promise<DeviceInfo> {
    return this.lock.acquire('get-info-cache', async () => {
      if (this.infoCache && Date.now() - this.infoCache.setAt < 100) {
        return this.infoCache.data;
      }

      const deviceInfo = await this.sendCommand('deviceInfo');
      this.infoCache = {
        data: deviceInfo,
        setAt: Date.now()
      };

      return deviceInfo;
    });
  }

  public async sendCommand<T extends Command>(
    command: T,
    ...args: Parameters<Commands[T]>
  ): Promise<CommandReturnType<T>> {
    return this.lock.acquire(
      'send-command',
      (): Promise<CommandReturnType<T>> => {
        return this.sendCommandWithNoLock(command, ...args);
      }
    );
  }

  private async sendCommandWithNoLock<T extends Command>(
    command: T,
    ...args: Parameters<Commands[T]>
  ): Promise<CommandReturnType<T>> {
    if (!commands[command.toString()]) {
      return false as CommandReturnType<T>;
    }

    if (!this.loginToken || this.needsNewHandshake() || this.tryResendCommand) {
      this.log.info('Trying to login again.');
      await this.login();
    }

    const { __method__, ...params } = commands[command.toString()](...args);

    const { body } = await this.sendSecureRequest(
      __method__ ?? 'set_device_info',
      params,
      true
    );

    if (body.error_code && body.error_code !== 0) {
      if (!this.tryResendCommand && `${body.error_code}` === '9999') {
        this.tryResendCommand = true;
        this.log.info('Session expired');
        return this.sendCommandWithNoLock(command, ...args);
      }

      this.log.error('Command error:', command, '>', body.error_code);
    }

    this.tryResendCommand = false;
    return (body?.result ?? body?.error_code === 0) as CommandReturnType<T>;
  }

  private async login() {
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

  private async sendRequest(
    method: string,
    params: {
      [key: string]: any;
    },
    setCookie = false
  ) {
    const url = new URL(`http://${this.ip}/app`);
    return fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(setCookie && this.handshakeData.cookie
          ? {
              Cookie: this.handshakeData.cookie
            }
          : {})
      },
      method: 'POST',
      body: JSON.stringify({
        method,
        params,
        requestTimeMils: Date.now()
      })
    });
  }

  private async sendSecureRequest(
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

    const url = new URL(
      `http://${this.ip}/app${useToken ? `?token=${this.loginToken!}` : ''}`
    );
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Cookie: this.handshakeData.cookie!
      },
      method: 'POST',
      body: JSON.stringify({
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
      })
    });

    let body = await response.json();
    if (body?.result?.response) {
      body = JSON.parse(this.tpLinkCipher!.decrypt(body.result.response));
    }

    return {
      response,
      body
    };
  }

  private needsNewHandshake() {
    if (!this.classSetup) {
      throw new Error('Execute the .setup() first!');
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

    const key = (await response.json())?.result?.key;
    const [cookie, timeout] =
      response.headers.get('set-cookie')?.split(';') ?? [];
    const expire = parseInt((timeout ?? '').split('=')[1] ?? '0');

    this.handshakeData.expire = Date.now() + expire * 1000;
    this.handshakeData.cookie = cookie;

    this.tpLinkCipher = this.decodeHandshakeKey(key);
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
      decrypted.slice(0, keyLen),
      decrypted.slice(keyLen, keyLen * 2)
    );
  }
}
