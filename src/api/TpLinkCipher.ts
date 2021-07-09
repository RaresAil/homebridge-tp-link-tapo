import crypto from 'crypto';

export default class TpLinkCipher {
  constructor(private readonly key: Buffer, private readonly iv: Buffer) {}

  public static toBase64(data: string) {
    return Buffer.from(data.normalize('NFKC'), 'utf-8').toString('base64');
  }

  public static encodeUsername(data: string): string {
    const sha = crypto.createHash('sha1');
    sha.update(data.normalize('NFKC'));
    return sha.digest('hex');
  }

  public static createKeyPair(): Promise<{
    public: string;
    private: string;
  }> {
    return new Promise((resolve, reject) => {
      crypto.generateKeyPair(
        'rsa',
        {
          modulusLength: 1024
        },
        (err, publicK, privateK) => {
          if (err) {
            return reject(err);
          }

          const pub = publicK
            .export({
              format: 'pem',
              type: 'spki'
            })
            .toString('base64');
          const priv = privateK
            .export({
              format: 'pem',
              type: 'pkcs1'
            })
            .toString('base64');

          resolve({
            public: pub,
            private: priv
          });
        }
      );
    });
  }

  public encrypt(data: string) {
    const cipher = crypto.createCipheriv('aes-128-cbc', this.key, this.iv);
    const encrypted = cipher.update(data, 'utf8', 'base64');
    return `${encrypted}${cipher.final('base64')}`;
  }

  public decrypt(data: string) {
    const decipher = crypto.createDecipheriv('aes-128-cbc', this.key, this.iv);
    const decrypted = decipher.update(data, 'base64', 'utf8');
    return `${decrypted}${decipher.final('utf8')}`;
  }
}
