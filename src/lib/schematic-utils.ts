import pako from 'pako';

/**
 * Basic NBT Writer for Minecraft Sponge Schematic V2
 * Supports Compound, Int, Short, Byte, String, Byte Array, Int Array
 */
class NBTWriter {
  private buffer: ArrayBuffer;
  private bytes: Uint8Array;
  private view: DataView;
  private offset: number;

  constructor(initialSize: number = 256 * 1024) {
    this.buffer = new ArrayBuffer(initialSize);
    this.bytes = new Uint8Array(this.buffer);
    this.view = new DataView(this.buffer);
    this.offset = 0;
  }

  private ensureCapacity(additional: number) {
    if (this.offset + additional > this.buffer.byteLength) {
      const nextSize = Math.max(this.buffer.byteLength * 2, this.offset + additional + 65536);
      const newBuffer = new ArrayBuffer(nextSize);
      const newBytes = new Uint8Array(newBuffer);
      newBytes.set(this.bytes.subarray(0, this.offset));
      this.buffer = newBuffer;
      this.bytes = newBytes;
      this.view = new DataView(this.buffer);
    }
  }

  writeByte(val: number) {
    this.ensureCapacity(1);
    this.view.setInt8(this.offset++, val);
  }

  writeUnsignedByte(val: number) {
    this.ensureCapacity(1);
    this.bytes[this.offset++] = val & 0xff;
  }

  writeShort(val: number) {
    this.ensureCapacity(2);
    this.view.setInt16(this.offset, val);
    this.offset += 2;
  }

  writeInt(val: number) {
    this.ensureCapacity(4);
    this.view.setInt32(this.offset, val);
    this.offset += 4;
  }

  writeString(val: string) {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(val);
    this.writeShort(encoded.length);
    this.ensureCapacity(encoded.length);
    this.bytes.set(encoded, this.offset);
    this.offset += encoded.length;
  }

  writeByteArray(arr: Uint8Array) {
    this.writeInt(arr.length);
    this.ensureCapacity(arr.length);
    this.bytes.set(arr, this.offset);
    this.offset += arr.length;
  }

  writeIntArray(arr: Int32Array) {
    this.writeInt(arr.length);
    this.ensureCapacity(arr.length * 4);
    for (let i = 0; i < arr.length; i++) {
      this.view.setInt32(this.offset, arr[i]);
      this.offset += 4;
    }
  }

  writeTag(type: number, name: string | null) {
    this.writeByte(type);
    if (name !== null) {
      this.writeString(name);
    }
  }

  getUint8Array(): Uint8Array {
    return this.bytes.subarray(0, this.offset);
  }
}

export function generateSpongeSchematic(
  _pixelData: Uint8ClampedArray,
  width: number,
  height: number,
  palette: string[],
  orientation: 'vertical' | 'horizontal' = 'vertical',
  rotation: number = 0
): Blob {
  if (width < 1 || height < 1 || palette.length !== width * height) {
    throw new Error('Invalid dimensions or palette data for schematic export.');
  }

  const writer = new NBTWriter(Math.max(65536, width * height * 2));

  // Root Compound
  writer.writeTag(10, 'Schematic');

  // Version (Sponge Schematic V2)
  writer.writeTag(3, 'Version');
  writer.writeInt(2);

  // DataVersion (1.16.5+ compatible)
  writer.writeTag(3, 'DataVersion');
  writer.writeInt(2586);

  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const swapAxes = normalizedRotation === 90 || normalizedRotation === 270;
  const rotatedWidth = swapAxes ? height : width;
  const rotatedHeight = swapAxes ? width : height;

  if (orientation === 'vertical') {
    writer.writeTag(2, 'Width');
    writer.writeShort(rotatedWidth);
    writer.writeTag(2, 'Height');
    writer.writeShort(rotatedHeight);
    writer.writeTag(2, 'Length');
    writer.writeShort(1);
  } else {
    writer.writeTag(2, 'Width');
    writer.writeShort(rotatedWidth);
    writer.writeTag(2, 'Height');
    writer.writeShort(1);
    writer.writeTag(2, 'Length');
    writer.writeShort(rotatedHeight);
  }

  // Offset
  writer.writeTag(11, 'Offset');
  writer.writeIntArray(new Int32Array([0, 0, 0]));

  // Palette
  writer.writeTag(10, 'Palette');
  const uniqueBlocks = Array.from(new Set(palette));
  const paletteMap = new Map<string, number>();
  uniqueBlocks.forEach((block, index) => {
    writer.writeTag(3, block);
    writer.writeInt(index);
    paletteMap.set(block, index);
  });
  writer.writeByte(0); // End Palette Compound

  // PaletteMax
  writer.writeTag(3, 'PaletteMax');
  writer.writeInt(uniqueBlocks.length);

  // BlockData: Sponge v2 index order is (y * Length + z) * Width + x
  // Pre-allocate worst-case 2 bytes per block (VarInt) and slice to exact byte length
  const totalBlocks = rotatedWidth * rotatedHeight;
  const blockDataBytes = new Uint8Array(totalBlocks * 2);
  let bytePos = 0;

  for (let row = 0; row < rotatedHeight; row++) {
    // In vertical orientation, Minecraft y=0 is the BOTTOM of the build, while image y=0 is the TOP.
    // In horizontal orientation, Minecraft z=0 is North (TOP of image) and z increases South (BOTTOM).
    const ry = orientation === 'vertical' ? rotatedHeight - 1 - row : row;

    for (let rx = 0; rx < rotatedWidth; rx++) {
      let ox: number;
      let oy: number;

      if (normalizedRotation === 90) {
        ox = ry;
        oy = height - 1 - rx;
      } else if (normalizedRotation === 180) {
        ox = width - 1 - rx;
        oy = height - 1 - ry;
      } else if (normalizedRotation === 270) {
        ox = width - 1 - ry;
        oy = rx;
      } else {
        ox = rx;
        oy = ry;
      }

      const idx = oy * width + ox;
      const blockId = palette[idx];
      let v = paletteMap.get(blockId) ?? 0;

      while (v >= 0x80) {
        blockDataBytes[bytePos++] = (v & 0x7f) | 0x80;
        v >>>= 7;
      }
      blockDataBytes[bytePos++] = v;
    }
  }

  writer.writeTag(7, 'BlockData');
  writer.writeByteArray(blockDataBytes.subarray(0, bytePos));

  // End Root Compound
  writer.writeByte(0);

  const compressed = pako.gzip(writer.getUint8Array());
  return new Blob([compressed], { type: 'application/octet-stream' });
}
