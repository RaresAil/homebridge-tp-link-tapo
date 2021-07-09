import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic
} from 'homebridge';
import Context from './@types/Context';
import TPLink from './api/TPLink';
import LightBulbAccessory from './LightBulbAccessory';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

export default class Platform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic =
    this.api.hap.Characteristic;

  public readonly accessories: PlatformAccessory<Context>[] = [];
  public readonly registeredDevices: LightBulbAccessory[] = [];

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
  }

  private async loadDevice(ip: string, email: string, password: string) {
    const uuid = this.api.hap.uuid.generate(ip);

    try {
      const tpLink = await new TPLink(ip, email, password, this.log).setup();
      const deviceInfo = await tpLink.getInfo();
      if (!deviceInfo) {
        this.log.error('Failed to get info about:', ip);
        this.removeDevice(uuid);
        return;
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

        this.registeredDevices.push(
          new LightBulbAccessory(
            this,
            existingAccessory,
            this.log,
            deviceInfo.model,
            deviceInfo.mac
          )
        );
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

      this.registeredDevices.push(
        new LightBulbAccessory(
          this,
          accessory,
          this.log,
          deviceInfo.model,
          deviceInfo.mac
        )
      );
      return this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory
      ]);
    } catch (err) {
      this.log.error('Failed to get info about:', ip, '|', err.message);
      this.removeDevice(uuid);
    }
  }

  private removeDevice(uuid: string) {
    const accessory = this.accessories.find((acc) => acc.UUID === uuid);
    if (accessory) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory
      ]);
    }
  }

  private checkOldDevices() {
    this.accessories.map((accessory) => {
      const exists = this.registeredDevices.find(
        (device) => device.UUID === accessory.UUID
      );

      if (!exists) {
        this.log.info('Remove cached accessory:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
          accessory
        ]);
      }
    });
  }
}
