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
  TP_LINK_VALUES,
  HOME_KIT_VALUES
} from '../../../utils/translateColorTemp';

const characteristic: {
  get: CharacteristicGetHandler;
  set: CharacteristicSetHandler;
} & AccessoryThisType = {
  get: async function (): Promise<Nullable<CharacteristicValue>> {
    const deviceInfo = await this.tpLink.getInfo();
    const value = toHomeKitValues(deviceInfo.color_temp || TP_LINK_VALUES.min);

    if (value < HOME_KIT_VALUES.min) {
      return HOME_KIT_VALUES.min;
    }

    if (value > HOME_KIT_VALUES.max) {
      return HOME_KIT_VALUES.max;
    }

    return value;
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
