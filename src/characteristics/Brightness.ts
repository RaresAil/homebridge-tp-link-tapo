import {
  CharacteristicGetHandler,
  CharacteristicSetHandler,
  CharacteristicValue,
  Nullable
} from 'homebridge';

import { AccessoryThisType } from '../LightBulbAccessory';

const characteristic: {
  get: CharacteristicGetHandler;
  set: CharacteristicSetHandler;
} & AccessoryThisType = {
  get: async function (): Promise<Nullable<CharacteristicValue>> {
    const deviceInfo = await this.tpLink.getInfo();
    return deviceInfo.brightness || 100;
  },
  set: async function (value: CharacteristicValue) {
    await this.tpLink.sendCommand('brightness', parseInt(value.toString()));
  }
};

export default characteristic;
