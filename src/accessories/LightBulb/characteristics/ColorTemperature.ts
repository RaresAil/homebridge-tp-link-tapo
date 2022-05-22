import {
  CharacteristicGetHandler,
  CharacteristicSetHandler,
  CharacteristicValue,
  Nullable
} from 'homebridge';

import { AccessoryThisType } from '..';

import {
  toHomeKitValues,
  toTPLinkValues,
  TP_LINK_VALUES
} from '../../../utils/translateColorTemp';

const characteristic: {
  get: CharacteristicGetHandler;
  set: CharacteristicSetHandler;
} & AccessoryThisType = {
  get: async function (): Promise<Nullable<CharacteristicValue>> {
    const deviceInfo = await this.tpLink.getInfo();
    return toHomeKitValues(deviceInfo.color_temp || TP_LINK_VALUES.min);
  },
  set: async function (value: CharacteristicValue) {
    try {
      await this.tpLink.sendCommand(
        'colorTemp',
        toTPLinkValues(parseInt(value.toString()))
      );
    } catch (err: any) {
      this.log.error('Failed to set colorTemp:', this.mac, '|', err.message);
    }
  }
};

export default characteristic;
