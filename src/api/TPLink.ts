import AsyncLock from 'async-lock';

import DeviceInfo from './@types/DeviceInfo';
import { Logger } from 'homebridge';
import LegacyAPI from './LegacyAPI';
import commands from './commands';
import API from './@types/API';
// import Protocol from './@types/Protocol';

export interface HandshakeData {
  cookie?: string;
  expire: number;
}

type Commands = typeof commands;
type Command = keyof Commands;
type CommandReturnType<T extends Command> = ReturnType<Commands[T]>;

export default class TPLink {
  private readonly lock: AsyncLock;
  private api: API;

  private classSetup = false;

  private tryResendCommand = false;

  private _prevPowerState = false;
  private _unsentData: any = {};

  private infoCache?: {
    data: DeviceInfo;
    setAt: number;
  };

  constructor(
    ip: string,
    email: string,
    password: string,
    private readonly log: Logger
  ) {
    this.lock = new AsyncLock();
    this.api = new LegacyAPI(ip, email, password, log);
  }

  public async setup(): Promise<TPLink> {
    try {
      if (this.classSetup) {
        return this;
      }

      await this.api.setup();
      this.classSetup = true;

      // await this.checkProtocol();
    } catch (e) {
      this.log.error('Error setting up TPLink class:', e);
    }

    return this;
  }

  public async getInfo(): Promise<DeviceInfo> {
    return this.lock.acquire('get-info-cache', async () => {
      if (this.infoCache && Date.now() - this.infoCache.setAt < 100) {
        return this.infoCache.data;
      }

      const deviceInfo = (await this.sendCommand('deviceInfo')) ?? {};
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

  public async sendHubCommand<T extends Command>(
    command: T,
    childId: string,
    ...args: Parameters<Commands[T]>
  ): Promise<CommandReturnType<T>> {
    return this.lock.acquire(
      `send-hub-command-${childId}`,
      (): Promise<CommandReturnType<T>> => {
        return this.sendCommandWithNoLock(command, args, false);
      }
    );
  }

  private async sendCommandWithNoLock<T extends Command>(
    command: T,
    args: Parameters<Commands[T]>,
    isDeviceOn = false
  ): Promise<CommandReturnType<T>> {
    try {
      if (!commands[command.toString()]) {
        return false as CommandReturnType<T>;
      }

      if (this.api.needsNewHandshake() || this.tryResendCommand) {
        if (this.tryResendCommand) {
          this.log.info('Trying to login again.');
        }

        await this.api.login();
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

      const { body } = await this.api.sendSecureRequest(
        validMethod,
        {
          ...extraData,
          ...params
        },
        true,
        false
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
    } catch (e: any) {
      this.log.error('Error sending command:', command, e);
      this.tryResendCommand = false;
      return null as CommandReturnType<T>;
    }
  }

  // private async checkProtocol(): Promise<Protocol> {
  //   try {
  //     const response = await this.api.sendRequest('checkProtocol', {}, false);
  //     console.log(response.data, response.status);
  //     return Protocol.Legacy;
  //   } catch (e) {
  //     console.error('Legacy protocol not supported', e);
  //     return Protocol.KLAP;
  //   }
  // }
}
