import {
  CharacteristicGetHandler,
  CharacteristicSetHandler,
  CharacteristicValue,
  Nullable
} from 'homebridge';

import { AccessoryThisType } from '..';

const characteristic: {
  get: CharacteristicGetHandler;
  set: CharacteristicSetHandler;
} & AccessoryThisType = {
  get: async function (): Promise<Nullable<CharacteristicValue>> {
    const deviceInfo = await this.tpLink.getInfo();
    return deviceInfo.brightness || 100;
  },
  set: async function (value: CharacteristicValue) {
    try {
      await this.tpLink.sendCommand('brightness', parseInt(value.toString()));
    } catch (err: any) {
      this.log.error('Failed to set brightness:', this.mac, '|', err.message);
    }
  }
};

export default characteristic;
