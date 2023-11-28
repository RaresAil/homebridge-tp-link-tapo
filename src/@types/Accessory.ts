import { Logger, PlatformAccessory } from 'homebridge';

import { ChildInfo } from '../api/@types/ChildListInfo';
import DeviceInfo from '../api/@types/DeviceInfo';
import TPLink from '../api/TPLink';
import Platform from '../platform';
import Context from './Context';

export enum AccessoryType {
  LightBulb = 'LightBulb',
  Unknown = 'Unknown',
  Outlet = 'Outlet',
  Hub = 'Hub'
}

export enum ChildType {
  Unknown = 'Unknown',
  Button = 'LightBulb',
  Contact = 'Contact',
  MotionSensor = 'MotionSensor'
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

    if (deviceInfo?.type?.includes('HUB')) {
      return AccessoryType.Hub;
    }

    return AccessoryType.Unknown;
  }

  public static GetChildType(deviceInfo: ChildInfo): ChildType {
    if (deviceInfo?.type?.includes('SENSOR')) {
      if (deviceInfo?.category?.includes('button')) {
        return ChildType.Button;
      }

      if (deviceInfo?.category?.includes('contact-sensor')) {
        return ChildType.Contact;
      }

      if (deviceInfo?.category?.includes('motion-sensor')) {
        return ChildType.MotionSensor;
      }
    }

    return ChildType.Unknown;
  }

  public abstract get UUID(): string;

  constructor(
    protected readonly platform: Platform,
    protected readonly accessory: PlatformAccessory<Context>,
    protected readonly log: Logger,
    protected readonly deviceInfo: DeviceInfo | ChildInfo
  ) {
    this.tpLink = accessory.context.tpLink;
    this.model = deviceInfo.model;
    this.mac = deviceInfo.mac;
  }
}

export default Accessory;
