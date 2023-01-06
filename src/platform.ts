import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic
} from 'homebridge';

import Accessory, { AccessoryType } from './@types/Accessory';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import DeviceInfo from './api/@types/DeviceInfo';
import Context from './@types/Context';
import TPLink from './api/TPLink';
import delay from './utils/delay';

import LightBulbAccessory from './accessories/LightBulb';
import OutletAccessory from './accessories/Outlet';

export default class Platform implements DynamicPlatformPlugin {
  private readonly TIMEOUT_TRIES = 20;

  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic =
    this.api.hap.Characteristic;

  public readonly accessories: PlatformAccessory<Context>[] = [];
  public readonly registeredDevices: Accessory[] = [];
  private readonly deviceRetry: {
    [key: string]: number;
  } = {};

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory<Context>) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  private async discoverDevices() {
    try {
      const { email, password, addresses } = this.config ?? {};
      if (
        !email ||
        !password ||
        !addresses ||
        !Array.isArray(addresses) ||
        addresses.length <= 0
      ) {
        if (this.accessories.length > 0) {
          this.api.unregisterPlatformAccessories(
            PLUGIN_NAME,
            PLATFORM_NAME,
            this.accessories
          );
        }

        return;
      }

      await Promise.all(
        addresses.map((address) => this.loadDevice(address, email, password))
      );

      this.checkOldDevices();
    } catch (err: any) {
      this.log.error('Failed to discover devices:', err.message);
    }
  }

  private async loadDevice(ip: string, email: string, password: string) {
    const uuid = this.api.hap.uuid.generate(ip);
    if (this.deviceRetry[uuid] === undefined) {
      this.deviceRetry[uuid] = this.TIMEOUT_TRIES;
    } else if (this.deviceRetry[uuid] <= 0) {
      this.log.info('Retry timeout:', ip);
      return;
    } else {
      this.log.info('Retry to connect in 10s', ':', ip);
      await delay(10 * 1000);
      this.log.info(
        'Try for',
        ip,
        ':',
        `${this.deviceRetry[uuid]}/${this.TIMEOUT_TRIES}`
      );
    }

    try {
      const tpLink = await new TPLink(ip, email, password, this.log).setup();
      const deviceInfo = await tpLink.getInfo();
      if (!deviceInfo) {
        this.log.error('Failed to get info about:', ip);
        this.deviceRetry[uuid] -= 1;
        return await this.loadDevice(ip, email, password);
      }

      const deviceName = Buffer.from(deviceInfo.nickname, 'base64').toString(
        'utf-8'
      );

      const existingAccessory = this.accessories.find(
        (accessory) => accessory.UUID === uuid
      );

      if (existingAccessory) {
        this.log.info(
          'Restoring existing accessory from cache:',
          existingAccessory.displayName
        );
        existingAccessory.context = {
          name: deviceName,
          tpLink
        };

        const registeredAccessory = this.registerAccessory(
          existingAccessory,
          deviceInfo
        );
        if (!registeredAccessory) {
          this.log.error(
            'Failed to register accessory "%s" of type "%s" (%s)',
            deviceName,
            Accessory.GetType(deviceInfo),
            deviceInfo?.type
          );
          return;
        }

        this.registeredDevices.push(registeredAccessory);
        return;
      }

      this.log.info('Adding new accessory:', deviceName);
      const accessory = new this.api.platformAccessory<Context>(
        deviceName,
        uuid
      );
      accessory.context = {
        name: deviceName,
        tpLink
      };

      const registeredAccessory = this.registerAccessory(accessory, deviceInfo);
      if (!registeredAccessory) {
        this.log.error(
          'Failed to register accessory "%s" of type "%s" (%s)',
          deviceName,
          Accessory.GetType(deviceInfo),
          deviceInfo?.type
        );
        return;
      }

      this.registeredDevices.push(registeredAccessory);

      return this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory
      ]);
    } catch (err: any) {
      this.log.error('Failed to get info about:', ip, '|', err.message);
      this.deviceRetry[uuid] -= 1;
      return await this.loadDevice(ip, email, password);
    }
  }

  private checkOldDevices() {
    const addressesByUUID: Record<string, string> = (
      (this.config?.addresses as string[]) || []
    ).reduce(
      (acc, ip) => ({
        ...acc,
        [this.api.hap.uuid.generate(ip)]: ip
      }),
      {}
    );

    this.accessories.map((accessory) => {
      const exists = addressesByUUID[accessory.UUID.toString()];

      if (!exists) {
        this.log.info('Remove cached accessory:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
          accessory
        ]);
      }
    });
  }

  private readonly accessoryClasses = {
    [AccessoryType.LightBulb]: LightBulbAccessory,
    [AccessoryType.Outlet]: OutletAccessory
  };

  private registerAccessory(
    accessory: PlatformAccessory<Context>,
    deviceInfo: DeviceInfo
  ): Accessory | null {
    const AccessoryClass = this.accessoryClasses[Accessory.GetType(deviceInfo)];
    if (!AccessoryClass) {
      return null;
    }

    return new AccessoryClass(this, accessory, this.log, deviceInfo);
  }
}
