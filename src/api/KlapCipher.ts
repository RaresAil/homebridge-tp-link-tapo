import crypto from 'crypto';

export default class KlapCipher {
  private readonly key: Buffer;
  private readonly sig: Buffer;
  private readonly iv: Buffer;
  private seq: number;

  constructor(localSeed: Buffer, remoteSeed: Buffer, authHash: Buffer) {
    const { iv, seq } = this.ivDerive(localSeed, remoteSeed, authHash);
    this.key = this.keyDerive(localSeed, remoteSeed, authHash);
    this.sig = this.sigDerive(localSeed, remoteSeed, authHash);
    this.iv = iv;
    this.seq = seq;
  }

  public encrypt(msg: Buffer | string) {
    this.seq += 1;

    if (typeof msg === 'string') {
      msg = Buffer.from(msg, 'utf8');
    }

    if (!Buffer.isBuffer(msg)) {
      throw new Error('msg must be a string or buffer');
    }

    const cipher = crypto.createCipheriv('aes-128-cbc', this.key, this.ivSeq());
    const cipherText = Buffer.concat([cipher.update(msg), cipher.final()]);

    const seqBuffer = Buffer.alloc(4);
    seqBuffer.writeInt32BE(this.seq, 0);

    const hash = crypto.createHash('sha256');
    hash.update(Buffer.concat([this.sig, seqBuffer, cipherText]));

    const signature = hash.digest();

    return {
      encrypted: Buffer.concat([signature, cipherText]),
      seq: this.seq
    };
  }

  public decrypt(msg: Buffer) {
    if (!Buffer.isBuffer(msg)) {
      throw new Error('msg must be a buffer');
    }

    const decipher = crypto.createDecipheriv(
      'aes-128-cbc',
      this.key,
      this.ivSeq()
    );
    const decrypted = Buffer.concat([
      decipher.update(msg.subarray(32)),
      decipher.final()
    ]);

    return decrypted.toString('utf8');
  }

  private keyDerive(l: Buffer, r: Buffer, h: Buffer) {
    const payload = Buffer.concat([Buffer.from('lsk'), l, r, h]);
    const hash = crypto.createHash('sha256').update(payload).digest();
    return hash.subarray(0, 16);
  }

  private ivDerive(l: Buffer, r: Buffer, h: Buffer) {
    const payload = Buffer.concat([Buffer.from('iv'), l, r, h]);
    const fullIv = crypto.createHash('sha256').update(payload).digest();
    const seq = fullIv.subarray(-4).readInt32BE(0);
    return { iv: fullIv.subarray(0, 12), seq: seq };
  }

  private sigDerive(l: Buffer, r: Buffer, h: Buffer) {
    const payload = Buffer.concat([Buffer.from('ldk'), l, r, h]);
    const hash = crypto.createHash('sha256').update(payload).digest();
    return hash.subarray(0, 28);
  }

  private ivSeq() {
    const seq = Buffer.alloc(4);
    seq.writeInt32BE(this.seq, 0);
    const iv = Buffer.concat([this.iv, seq]);

    if (iv.length !== 16) {
      throw new Error('Length of iv is not 16');
    }

    return iv;
  }
}
