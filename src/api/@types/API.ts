import { AxiosResponse } from 'axios';
import { Logger } from 'homebridge';
import crypto from 'crypto';

import TpLinkCipher from '../TpLinkCipher';

abstract class API {
  protected readonly terminalUUID: string;

  protected loginToken?: string;

  protected readonly rawEmail: string;
  protected readonly rawPassword: string;

  constructor(
    protected readonly ip: string,
    protected readonly email: string,
    protected readonly password: string,
    protected readonly log: Logger
  ) {
    this.email = TpLinkCipher.toBase64(TpLinkCipher.encodeUsername(this.email));
    this.password = TpLinkCipher.toBase64(this.password);
    this.terminalUUID = crypto.randomUUID();

    this.rawEmail = email;
    this.rawPassword = password;
  }

  public abstract login(): Promise<void>;

  public abstract setup(): Promise<void>;

  public abstract sendRequest(
    method: string,
    params: {
      [key: string]: any;
    },
    setCookie: boolean
  ): Promise<AxiosResponse<any, any>>;

  public abstract sendSecureRequest(
    method: string,
    params: {
      [key: string]: any;
    },
    useToken: boolean,
    forceHandshake: boolean
  ): Promise<{
    body: any;
    response: AxiosResponse<any, any>;
  }>;

  public abstract needsNewHandshake(): boolean;
}

export default API;
