interface Values {
  min: number;
  max: number;
}

export const TP_LINK_VALUES: Values = {
  min: 2500,
  max: 6500
};

export const HOME_KIT_VALUES: Values = {
  min: 140,
  max: 364
};

const getZeroMax = (values: Values) => values.max - values.min;

const zeroMaxTPLink = getZeroMax(TP_LINK_VALUES);
const zeroMaxHomeKit = getZeroMax(HOME_KIT_VALUES);

export const toHomeKitValues = (input: number) => {
  return Math.round(
    (1 - (input - TP_LINK_VALUES.min) / zeroMaxTPLink) * zeroMaxHomeKit +
      HOME_KIT_VALUES.min
  );
};
export const toTPLinkValues = (input: number) => {
  return Math.round(
    (1 - (input - HOME_KIT_VALUES.min) / zeroMaxHomeKit) * zeroMaxTPLink +
      TP_LINK_VALUES.min
  );
};
