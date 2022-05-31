import { Logger, PlatformAccessory } from 'homebridge';

import DeviceInfo from '../api/@types/DeviceInfo';
import TPLink from '../api/TPLink';
import Platform from '../platform';
import Context from './Context';

export enum AccessoryType {
  LightBulb = 'LightBulb',
  Unknown = 'Unknown',
  Outlet = 'Outlet'
}

abstract class Accessory {
  protected readonly tpLink: TPLink;
  protected readonly model: string;
  protected readonly mac: string;

  public static GetType(deviceInfo: DeviceInfo): AccessoryType {
    if (deviceInfo?.type?.includes('BULB')) {
      return AccessoryType.LightBulb;
    }

    if (deviceInfo?.type?.includes('PLUG')) {
      return AccessoryType.Outlet;
    }

    return AccessoryType.Unknown;
  }

  public abstract get UUID(): string;

  constructor(
    protected readonly platform: Platform,
    protected readonly accessory: PlatformAccessory<Context>,
    protected readonly log: Logger,
    protected readonly deviceInfo: DeviceInfo
  ) {
    this.tpLink = accessory.context.tpLink;
    this.model = deviceInfo.model;
    this.mac = deviceInfo.mac;
  }
}

export default Accessory;
