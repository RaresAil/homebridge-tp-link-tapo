import AsyncLock from 'async-lock';
import crypto from 'crypto';
import axios from 'axios';
import { v4 } from 'uuid';

import DeviceInfo from './@types/DeviceInfo';
import TpLinkCipher from './TpLinkCipher';
import { Logger } from 'homebridge';
import commands from './commands';

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

  private tryResendCommand = false;
  private loginToken?: string;

  private _prevPowerState = false;
  private _unsentData: any = {};

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

      this._prevPowerState = deviceInfo.device_on ?? false;
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
        if (command === 'power') {
          if (args[0] === this._prevPowerState) {
            return this._prevPowerState as unknown as Promise<
              CommandReturnType<T>
            >;
          }

          this._prevPowerState = args[0] as boolean;
        }

        return this.sendCommandWithNoLock(command, args, this._prevPowerState);
      }
    );
  }

  private async sendCommandWithNoLock<T extends Command>(
    command: T,
    args: Parameters<Commands[T]>,
    isDeviceOn = false
  ): Promise<CommandReturnType<T>> {
    if (!commands[command.toString()]) {
      return false as CommandReturnType<T>;
    }

    if (!this.loginToken || this.needsNewHandshake() || this.tryResendCommand) {
      if (this.tryResendCommand) {
        this.log.info('Trying to login again.');
      }

      await this.login();
    }

    const { __method__, ...params } = commands[command.toString()](...args);
    const validMethod = __method__ ?? 'set_device_info';

    if (!isDeviceOn && validMethod === 'set_device_info') {
      const paramsToCache = { ...params };
      delete paramsToCache.device_on;

      if (command === 'colorTemp') {
        delete this._unsentData.saturation;
        delete this._unsentData.hue;
      }

      this._unsentData = {
        ...this._unsentData,
        ...paramsToCache
      };

      if (command !== 'power') {
        this.tryResendCommand = false;
        return true as CommandReturnType<T>;
      }
    }

    const extraData =
      isDeviceOn && validMethod === 'set_device_info'
        ? { ...this._unsentData }
        : {};

    if (isDeviceOn) {
      this._unsentData = {};
    }

    const { body } = await this.sendSecureRequest(
      validMethod,
      {
        ...extraData,
        ...params
      },
      true
    );

    if (body.error_code && body.error_code !== 0) {
      if (!this.tryResendCommand) {
        if (`${body.error_code}` === '9999') {
          this.tryResendCommand = true;
          this.log.info('Session expired');
          return this.sendCommandWithNoLock(command, args, isDeviceOn);
        }

        if (`${body.error_code}` === '-1301') {
          this.tryResendCommand = true;
          this.log.info('Rate limit exceeded. Renewing session.');
          return this.sendCommandWithNoLock(command, args, isDeviceOn);
        }
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

  private async sendSecureRequest(
    method: string,
    params: {
      [key: string]: any;
    },
    useToken = false,
    forceHandshake = false
  ): Promise<any> {
    if (forceHandshake) {
      await this.handshake();
    } else {
      if (this.needsNewHandshake()) {
        await this.handshake();
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

    const key = response?.data?.result?.key;
    const [cookie, timeout] =
      response?.headers?.['set-cookie']?.[0]?.split(';') ?? [];
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
