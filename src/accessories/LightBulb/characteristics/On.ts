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
    return deviceInfo.device_on || false;
  },
  set: async function (value: CharacteristicValue) {
    try {
      await this.tpLink.sendCommand('power', value as boolean);
    } catch (err: any) {
      this.log.error('Failed to set power:', this.mac, '|', err.message);
    }
  }
};

export default characteristic;
