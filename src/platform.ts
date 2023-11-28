import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic
} from 'homebridge';

import Accessory, { AccessoryType, ChildType } from './@types/Accessory';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import DeviceInfo from './api/@types/DeviceInfo';
import Context from './@types/Context';
import TPLink from './api/TPLink';
import delay from './utils/delay';

import HubAccessory, { HubContext } from './accessories/Hub';
import LightBulbAccessory from './accessories/LightBulb';
import OutletAccessory from './accessories/Outlet';
import { ChildInfo } from './api/@types/ChildListInfo';
import ButtonAccessory from './accessories/Button';
import ContactAccessory from './accessories/Contact';
import MotionSensorAccessory from './accessories/MotionSensor';

export default class Platform implements DynamicPlatformPlugin {
  private readonly TIMEOUT_TRIES = 20;

  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic =
    this.api.hap.Characteristic;

  public readonly accessories: PlatformAccessory<Context | HubContext>[] = [];
  public readonly loadedChildUUIDs: Record<string, true> = {};
  public readonly registeredDevices: Accessory[] = [];
  public readonly hubs: HubAccessory[] = [];
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

      await Promise.all(
        this.hubs.map(async (hub) => {
          const devices = await hub.getChildDevices();
          await Promise.all(
            devices.map((device) => {
              if (Object.keys(device || {}).length === 0) {
                return Promise.resolve();
              }

              this.loadedChildUUIDs[
                this.api.hap.uuid.generate(device.device_id)
              ] = true;
              return this.loadChildDevice(device.device_id, device, hub);
            })
          );
        })
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
      if (Object.keys(deviceInfo || {}).length === 0) {
        this.log.error('Failed to get info about:', ip);
        this.deviceRetry[uuid] -= 1;
        return await this.loadDevice(ip, email, password);
      }

      const deviceName = Buffer.from(
        deviceInfo?.nickname || 'Tm8gTmFtZQ==',
        'base64'
      ).toString('utf-8');

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
          tpLink,
          child: false
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
        tpLink,
        child: false
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

  private async loadChildDevice(
    id: string,
    deviceInfo: ChildInfo,
    parent: HubAccessory
  ) {
    const uuid = this.api.hap.uuid.generate(id);
    if (this.deviceRetry[uuid] === undefined) {
      this.deviceRetry[uuid] = this.TIMEOUT_TRIES;
    } else if (this.deviceRetry[uuid] <= 0) {
      this.log.info('Retry timeout:', id);
      return;
    } else {
      this.log.info('Retry to connect in 10s', ':', id);
      await delay(10 * 1000);
      this.log.info(
        'Try for',
        id,
        ':',
        `${this.deviceRetry[uuid]}/${this.TIMEOUT_TRIES}`
      );
    }

    try {
      const deviceName = Buffer.from(
        deviceInfo.nickname || 'Tm8gTmFtZQ==',
        'base64'
      ).toString('utf-8');

      const existingAccessory = this.accessories.find(
        (accessory) => accessory.UUID === uuid
      );

      if (existingAccessory) {
        this.log.info(
          'Restoring existing child accessory from cache:',
          existingAccessory.displayName
        );
        existingAccessory.context = {
          name: deviceName,
          child: true,
          parent: parent.UUID
        };

        const registeredAccessory = this.registerChild(
          existingAccessory,
          deviceInfo,
          parent
        );

        if (!registeredAccessory) {
          this.log.error(
            'Failed to register child accessory "%s" of type "%s" (%s)',
            deviceName,
            Accessory.GetChildType(deviceInfo),
            deviceInfo?.type
          );
          return;
        }

        this.registeredDevices.push(registeredAccessory);
        return;
      }

      this.log.info('Adding new child accessory:', deviceName);
      const accessory = new this.api.platformAccessory<HubContext>(
        deviceName,
        uuid
      );
      accessory.context = {
        name: deviceName,
        child: true,
        parent: parent.UUID
      };

      const registeredAccessory = this.registerChild(
        accessory,
        deviceInfo,
        parent
      );
      if (!registeredAccessory) {
        this.log.error(
          'Failed to register child accessory "%s" of type "%s" (%s)',
          deviceName,
          Accessory.GetChildType(deviceInfo),
          deviceInfo?.type
        );
        return;
      }

      this.registeredDevices.push(registeredAccessory);

      return this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory
      ]);
    } catch (err: any) {
      this.log.error('Failed to get info about child:', id, '|', err.message);
      this.deviceRetry[uuid] -= 1;
      return await this.loadChildDevice(id, deviceInfo, parent);
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
      const deleteDevice =
        (!accessory.context.child &&
          !addressesByUUID[accessory.UUID.toString()]) ||
        (accessory.context.child &&
          !addressesByUUID[accessory.context.parent]) ||
        (accessory.context.child &&
          addressesByUUID[accessory.context.parent] &&
          !this.loadedChildUUIDs[accessory.UUID.toString()]);

      if (deleteDevice) {
        this.log.info('Remove cached accessory:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
          accessory
        ]);
      }
    });
  }

  private readonly accessoryClasses = {
    [AccessoryType.LightBulb]: LightBulbAccessory,
    [AccessoryType.Outlet]: OutletAccessory,
    [AccessoryType.Hub]: HubAccessory
  };

  private registerAccessory(
    accessory: PlatformAccessory<Context | HubContext>,
    deviceInfo: DeviceInfo
  ): Accessory | null {
    const AccessoryClass = this.accessoryClasses[Accessory.GetType(deviceInfo)];
    if (!AccessoryClass) {
      return null;
    }

    const acc = new AccessoryClass(this, accessory, this.log, deviceInfo);

    if (acc instanceof HubAccessory) {
      this.hubs.push(acc);
    }

    return acc;
  }

  private readonly childClasses = {
    [ChildType.Button]: ButtonAccessory,
    [ChildType.Contact]: ContactAccessory,
    [ChildType.MotionSensor]: MotionSensorAccessory,
  };

  private registerChild(
    accessory: PlatformAccessory<Context | HubContext>,
    deviceInfo: ChildInfo,
    parent: HubAccessory
  ): Accessory | null {
    const ChildClass = this.childClasses[Accessory.GetChildType(deviceInfo)];
    if (!ChildClass) {
      return null;
    }

    return new ChildClass(parent, this, accessory, this.log, deviceInfo);
  }
}
