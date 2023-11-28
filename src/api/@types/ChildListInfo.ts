export interface ChildInfo {
  parent_device_id: string;
  hw_ver: string;
  fw_ver: string;
  device_id: string;
  mac: string;
  type: string;
  model: string;
  hw_id: string;
  oem_id: string;
  specs: string;
  category: string;
  bind_count: number;
  status_follow_edge: boolean;
  status: string;
  lastOnboardingTimestamp: number;
  rssi: number;
  signal_level: number;
  jamming_rssi: number;
  jamming_signal_level: number;
  at_low_battery: boolean;
  nickname: string;
  avatar: string;
  report_interval: number;
  region: string;
  detected: boolean;
}

interface ChildListInfo {
  child_device_list: ChildInfo[];
  start_index: number;
  sum: number;
}

export default ChildListInfo;
